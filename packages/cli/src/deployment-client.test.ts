import { SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createDeploymentClient, getAgentAuth } from "./deployment-client";

const now = Math.floor(Date.now() / 1000);
const scope = { name: "user", value: { userId: "one" } };
async function token(overrides = {}) {
  return new SignJWT({
    iss: "tailorkit-agent",
    aud: "tailorkit-platform-deploy",
    projectId: "project",
    appId: "app-one",
    scope,
    platformUrl: "https://platform.test/api/platform",
    iat: now,
    exp: now + 3600,
    ...overrides,
  })
    .setProtectedHeader({ alg: "HS256", typ: "tailorkit-agent+jwt" })
    .sign(new TextEncoder().encode("test-only-signing-key"));
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("uses existing platform deployment endpoints and scope from the agent JWT", async () => {
  const jwt = await token();
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", jwt);
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({}));
  const agent = getAgentAuth()!;
  const client = createDeploymentClient("http://localhost:1", jwt, agent);
  await client.deployments.create({
    appId: "app-one",
    assets: [
      {
        checksum: "a".repeat(64),
        contentLength: 10,
        contentType: "application/javascript",
        encoding: "gzip",
        objectKey: "client.js",
      },
    ],
  });
  await client.deployments.publish({ deploymentId: "deployment-one", rollout: true });
  const requests = fetch.mock.calls.map(([input]) => input as Request);
  expect(requests.map((request) => request.url)).toEqual([
    "https://platform.test/api/platform/deployments",
    "https://platform.test/api/platform/deployments/deployment-one",
  ]);
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBe(`Bearer ${jwt}`);
    expect(await request.json()).toMatchObject({ scope });
  }
  await expect(client.apps.create({ name: "App", description: null })).rejects.toThrow(
    "authorized existing app",
  );
});

it.each([
  { exp: now - 1 },
  { iat: now + 10 },
  { exp: now + 7200 },
  { platformUrl: "https://user:password@platform.test/api/platform" },
  { platformUrl: "https://platform.test/api/platform?query=1" },
  { aud: "different" },
  { scope: null },
])("rejects malformed or expired agent authorization %j", async (overrides) => {
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", await token(overrides));
  expect(getAgentAuth).toThrow(/agent authorization/i);
});

it("does not fall back when an explicitly supplied JWT is invalid or empty", () => {
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", "");
  expect(getAgentAuth).toThrow("Invalid agent authorization");
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", "bad-token");
  expect(getAgentAuth).toThrow("Invalid agent authorization");
});

it("retains actionable platform authentication errors", async () => {
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", await token());
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json(
      { code: "UNAUTHORIZED", message: "Agent authorization revoked." },
      { status: 401 },
    ),
  );
  const agent = getAgentAuth()!;
  await expect(
    createDeploymentClient("http://localhost:1", agent.token, agent).deployments.publish({
      deploymentId: "deployment-one",
    }),
  ).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Agent authorization revoked.",
  });
});
