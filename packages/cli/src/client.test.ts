import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { getAgentAuth } from "./agent-auth";
import { createCliClient } from "./client";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const now = Math.floor(Date.now() / 1000);
const scope = { name: "user", value: { userId: "one" } };
const token = async (overrides = {}) =>
  await new SignJWT({
    appId: "app-one",
    aud: "tailorkit-platform-cli",
    exp: now + 3600,
    iat: now,
    iss: "tailorkit-agent",
    platformUrl: "https://platform.test/api/platform",
    projectId: "project",
    scope,
    ...overrides,
  })
    .setProtectedHeader({ alg: "HS256", typ: "tailorkit-agent+jwt" })
    .sign(new TextEncoder().encode("test-only-signing-key"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("uses existing platform deployment endpoints and scope from the agent JWT", async () => {
  const jwt = await token();
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", jwt);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
    .mockImplementation(async () => Response.json({}));
  const client = createCliClient({ token: jwt, url: "http://localhost:1" });
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
  await client.deployments.publish({
    deploymentId: "deployment-one",
    rollout: true,
  });
  // SAFETY: The exercised fetch call constructs this Request; the test inspects the captured request after asserting the call occurred.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
  const requests = fetch.mock.calls.map(([input]) => input as Request);
  expect(requests.map((request) => request.url)).toEqual([
    "https://platform.test/api/platform/deployments",
    "https://platform.test/api/platform/deployments/deployment-one",
  ]);
  for (const request of requests) {
    expect(request.headers.get("authorization")).toBe(`Bearer ${jwt}`);
    expect(request.redirect).toBe("error");
    // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
    expect(await request.json()).toMatchObject({ scope });
  }
  await client.appAgent.create({
    description: null,
    name: "App",
  });
  const [appRequest] = requireValue(fetch.mock.lastCall);
  if (!(appRequest instanceof Request)) {
    throw new Error("Expected an app creation request.");
  }
  expect(appRequest.url).toBe(
    "https://platform.test/api/platform/app-agent/apps"
  );
  expect(await appRequest.json()).toEqual({
    deployToken: jwt,
    description: null,
    name: "App",
  });
});

it.each([
  { exp: now - 1 },
  { iat: now + 10 },
  { exp: now + 7200 },
  { platformUrl: "https://user:password@platform.test/api/platform" },
  { platformUrl: "https://platform.test/api/platform?query=1" },
  { aud: "different" },
  { scope: null },
  { platformUrl: "http://platform.test/api/platform" },
  { platformUrl: "http://localhost.evil.test/api/platform" },
])("rejects malformed or expired agent authorization %j", async (overrides) => {
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", await token(overrides));
  expect(getAgentAuth).toThrow(/agent authorization/iu);
});

it("does not fall back when an explicitly supplied JWT is invalid or empty", () => {
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", "");
  expect(getAgentAuth).toThrow("Invalid agent authorization");
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", "bad-token");
  expect(getAgentAuth).toThrow("Invalid agent authorization");
});

it("retains actionable platform authentication errors", async () => {
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", await token());
  // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json(
      { code: "UNAUTHORIZED", message: "Agent authorization revoked." },
      { status: 401 }
    )
  );
  const agent = requireValue(getAgentAuth());
  await expect(
    createCliClient({
      token: agent.token,
      url: "http://localhost:1",
    }).deployments.publish({
      deploymentId: "deployment-one",
    })
  ).rejects.toMatchObject({
    code: "UNAUTHORIZED",
    message: "Agent authorization revoked.",
  });
});

it.each([
  "https://platform.test/api/platform",
  "http://localhost/api/platform",
  "http://127.0.0.1/api/platform",
  "http://[::1]/api/platform",
])("allows secure or loopback destinations: %s", async (platformUrl) => {
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", await token({ platformUrl }));
  expect(requireValue(getAgentAuth()).platformUrl).toBe(platformUrl);
});

it("rejects insecure routing before creating a client or sending requests", async () => {
  vi.stubEnv(
    "TAILORKIT_AGENT_TOKEN",
    await token({ platformUrl: "http://platform.test/api/platform" })
  );
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(() =>
    createCliClient({ token: "stored-token", url: "http://localhost:1" })
  ).toThrow("Invalid agent authorization");
  expect(fetch).not.toHaveBeenCalled();
});

it("routes every authenticated CLI surface through existing platform endpoints for JWTs", async () => {
  const jwt = await token();
  vi.stubEnv("TAILORKIT_AGENT_TOKEN", jwt);
  const fetch = vi
    .spyOn(globalThis, "fetch")
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    .mockImplementation(async (input) => {
      // SAFETY: The exercised fetch call constructs this Request; the test inspects the captured request after asserting the call occurred.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
      const request = input as Request;
      expect(request.headers.get("authorization")).toBe(`Bearer ${jwt}`);
      expect(request.redirect).toBe("error");
      if (request.url.endsWith("/app-agent/chat")) {
        return new Response(
          'data: {"type":"start","messageId":"one"}\n\ndata: {"type":"finish"}\n\ndata: {"type":"data-run-complete","data":{"runId":"wrun_test"},"transient":true}\n\n',
          { headers: { "content-type": "text/event-stream" } }
        );
      }
      return Response.json({ scope });
    });
  const client = createCliClient({
    token: "stored-session",
    url: "http://localhost:1",
  });
  await client.cliAuth.verifyToken({});
  await client.apps.list({ page: 1, pageSize: 100 });
  await client.apps.create({ description: null, name: "App" });
  await client.preview.start({ appId: "app-one" });
  await client.preview.stop({ sessionId: "session-one" });
  const chunks = [];
  for await (const chunk of await client.appAgent.chat({
    appId: "app-one",
    hostUrl: "http://localhost:1",
    messages: [
      { id: "user", parts: [{ text: "Build", type: "text" }], role: "user" },
    ],
    schema: {},
    type: "turn",
  })) {
    chunks.push(chunk);
  }
  expect(chunks).toEqual([
    { messageId: "one", type: "start" },
    { type: "finish" },
    {
      data: { runId: "wrun_test" },
      transient: true,
      type: "data-run-complete",
    },
  ]);
  // SAFETY: The exercised fetch call constructs this Request; the test inspects the captured request after asserting the call occurred.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
  expect(fetch.mock.calls.map(([input]) => (input as Request).url)).toEqual([
    "https://platform.test/api/platform/cli-auth/verify-token",
    "https://platform.test/api/platform/apps/list",
    "https://platform.test/api/platform/apps",
    "https://platform.test/api/platform/preview/start",
    "https://platform.test/api/platform/preview/session-one/stop",
    "https://platform.test/api/platform/app-agent/chat",
  ]);
  expect(() => {
    void client.apps.list({ scopes: ["other"] });
  }).toThrow("Requested scope");
});

it("discovers file authorization for all commands, with environment-token precedence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-agent-auth-"));
  try {
    const jwt = await token();
    const file = path.join(root, "token");
    await writeFile(file, jwt, { mode: 0o600 });
    vi.stubEnv("TAILORKIT_AGENT_TOKEN_FILE", file);
    expect(requireValue(getAgentAuth()).token).toBe(jwt);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ scope }));
    await createCliClient({
      token: "stored-session",
      url: "http://localhost:1",
    }).cliAuth.verifyToken({});
    // SAFETY: The exercised fetch call constructs this Request; the test inspects the captured request after asserting the call occurred.
    expect(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
      (requireValue(fetch.mock.lastCall)[0] as Request).headers.get(
        "authorization"
      )
    ).toBe(`Bearer ${jwt}`);
    vi.stubEnv("TAILORKIT_AGENT_TOKEN", "");
    expect(getAgentAuth).toThrow("Invalid agent authorization");
    // oxlint-disable-next-line unicorn/no-useless-undefined -- Vitest requires the environment value argument.
    vi.stubEnv("TAILORKIT_AGENT_TOKEN", undefined);
    vi.stubEnv("TAILORKIT_AGENT_TOKEN_FILE", path.join(root, "missing"));
    expect(getAgentAuth).toThrow("Unable to read agent authorization file");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
