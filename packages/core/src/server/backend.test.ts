import type { AppsRuntimeSessionResponses } from "@patchsmith/client-platform/client/types.gen";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { createPatchsmithServer } from "./handler";
import type { PatchsmithScopes } from "./types";

type IssueSession = (
  appId: string,
  scopes: PatchsmithScopes,
  subjectId: string
) => Promise<AppsRuntimeSessionResponses[200] | Response>;

// Exercise the actual HTTP router; this adapter models only the downstream platform service.
const handleBackendSession = async (
  input: Request,
  authenticate: (input: { request: Request }) => Promise<{
    subjectId: string;
    scopes: { workspace: { id: string } };
  } | null>,
  issue: IssueSession
) => {
  const server = createPatchsmithServer({
    $internal: {
      platformFetch: async (request, init) => {
        const body = z
          .object({
            app: z.object({ shortId: z.string() }),
            scopes: z.array(
              z.object({
                name: z.string(),
                value: z.record(z.string(), z.string()),
              })
            ),
            subjectId: z.string(),
          })
          .parse(await new Request(request, init).json());

        const result = await issue(
          body.app.shortId,
          Object.fromEntries(
            body.scopes.map(({ name, value }) => [name, value])
          ),
          body.subjectId
        );

        return result instanceof Response ? result : Response.json(result);
      },
    },
    baseUrl: "https://host.test/api/patchsmith",
    components: {},
    scopes: { workspace: z.object({ id: z.string() }) },
  });

  return await server.handler(input, { authenticate });
};

const session = {
  expiresAt: 123,
  identity: {
    appId: "app",
    appShortId: "short-app",
    deploymentId: "deployment",
    expiresAt: 123,
    installationId: "app",
    projectId: "project",
    projectShortId: "short-project",
    scope: { name: "workspace", value: { id: "authorized-workspace" } },
    subjectId: "principal",
    toolUrl: "https://host.test/api/patchsmith/tools/execute",
  },
  token: "platform-issued-token",
  url: "https://runtime.test/rpc",
};

const issueSession = vi
  .fn<() => Promise<typeof session>>()
  .mockResolvedValue(session);

const authenticate = vi
  .fn<Parameters<typeof handleBackendSession>[1]>()
  .mockResolvedValue({
    scopes: { workspace: { id: "authorized-workspace" } },
    subjectId: "principal",
  });

interface BackendSessionFixture {
  appId: string | number;
  installationId?: string;
  subjectId?: string;
  scopes?: { workspace: { id: string } };
  url?: string;
}

const request = (
  body: BackendSessionFixture | null,
  origin = "https://host.test"
) =>
  new Request("https://host.test/api/patchsmith/backend/session", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });

beforeEach(() => vi.clearAllMocks());

it("uses existing host authentication and passes the verified subject and scopes to the platform", async () => {
  const input = request({ appId: "installed-app" });

  const response = await handleBackendSession(
    input,
    authenticate,
    issueSession
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(session);
  expect(authenticate).toHaveBeenCalledWith({ request: input });
  expect(issueSession).toHaveBeenCalledExactlyOnceWith(
    "installed-app",
    {
      workspace: { id: "authorized-workspace" },
    },
    "principal"
  );
});

it("rejects unauthenticated requests before issuing tokens", async () => {
  const response = await handleBackendSession(
    request({ appId: "app" }),
    vi.fn<Parameters<typeof handleBackendSession>[1]>().mockResolvedValue(null),
    issueSession
  );

  expect(response.status).toBe(401);
  expect(issueSession).not.toHaveBeenCalled();
});

it.each([
  { appId: "app", installationId: "victim" },
  { appId: "app", subjectId: "victim" },
  { appId: "app", scopes: { workspace: { id: "victim" } } },
  { appId: "app", url: "https://attacker.test/rpc" },
  { appId: "" },
  { appId: 1 },
  { appId: "x".repeat(257) },
  null,
])("rejects invalid or forged session input %j", async (body) => {
  const response = await handleBackendSession(
    request(body),
    authenticate,
    issueSession
  );

  expect(response.status).toBe(400);
  expect(issueSession).not.toHaveBeenCalled();
});

it("rejects cross-origin requests before authenticating or issuing tokens", async () => {
  const response = await handleBackendSession(
    request({ appId: "app" }, "https://attacker.test"),
    authenticate,
    issueSession
  );

  expect(response.status).toBe(400);
  expect(authenticate).not.toHaveBeenCalled();
  expect(issueSession).not.toHaveBeenCalled();
});

it.each(["GET", "PUT"])("rejects %s session requests", async (method) => {
  const response = await handleBackendSession(
    new Request("https://host.test/api/patchsmith/backend/session", { method }),
    authenticate,
    issueSession
  );

  expect(response.status).toBe(404);
  expect(issueSession).not.toHaveBeenCalled();
});

it("bounds chunked session request bodies", async () => {
  const response = await handleBackendSession(
    request({ appId: "x".repeat(4096) }),
    authenticate,
    issueSession
  );

  expect(response.status).toBe(413);
  expect(issueSession).not.toHaveBeenCalled();
});

it("rejects malformed JSON", async () => {
  const response = await handleBackendSession(
    new Request("https://host.test/api/patchsmith/backend/session", {
      body: "{",
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    authenticate,
    issueSession
  );

  expect(response.status).toBe(400);
  expect(issueSession).not.toHaveBeenCalled();
});
