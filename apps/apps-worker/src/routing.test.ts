import { AppError } from "@tailorkit/app/server";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import worker from "./worker";

const state = vi.hoisted(() => ({ verify: vi.fn() }));

vi.mock("./supervisor/auth", () => ({ verifier: () => state.verify }));

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const projectId = "22222222-2222-4222-8222-222222222222";

const publicTeamId = "abc123def45678";

const appPublicId = "app000000001";

const rpc = `https://${publicTeamId}.tailorkit.app/p/${projectId}/a/${appPublicId}/rpc`;

const publication = `https://internal.tailorkit.app/p/${projectId}/a/${appPublicId}/new-deployment`;

const secret = "s".repeat(32);

const identity = {
  appId: "private-app",
  appPublicId,
  installationId: "installation",
  projectId,
  publicTeamId,
};

const metadata = {
  appId: "private-app",
  checksum: "a".repeat(64),
  contentLength: 100,
  deploymentId: "private-deployment",
  objectKey: `teams/${publicTeamId}/projects/${projectId}/apps/${appPublicId}/deployments/deploy000001/server/server.js`,
  projectId,
};

const fetchInstallation = vi.fn(
  async (_request: Request) => await new Response("result")
);

const getByName = vi.fn(() => ({ fetch: fetchInstallation }));

const put = vi.fn(async () => {});

const env = {
  ASSET_DOMAIN: "tailorkit.app",
  DEPLOYMENTS: { put },
  PLATFORM_URL: "https://platform.test/api/platform",
  RUNTIME_SERVICE_TOKEN: secret,
  STORES: { getByName },
} as unknown as Env;

const ctx = {} as ExecutionContext;

const call = (request: Request) => worker.fetch(request, env, ctx);

const post = (url: string, body: unknown = metadata, token = secret) =>
  new Request(url, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });

beforeEach(() => {
  vi.clearAllMocks();
  state.verify.mockReturnValue(Effect.succeed(identity));
});

afterEach(() => vi.restoreAllMocks());

it("forwards stable app RPC routes and body to the installation without caching", async () => {
  const response = await call(
    post(`${rpc}/mutations`, { json: { name: "add" } }, "session")
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const [request] = require(fetchInstallation.mock.calls[0]);
  expect(new URL(request.url).pathname).toBe("/rpc/mutations");
  expect(await request.json()).toEqual({ json: { name: "add" } });
  expect(state.verify).toHaveBeenCalledWith("session");
});

it.each([
  rpc.replace(publicTeamId, "xyz123def45678"),
  rpc.replace(projectId, "33333333-3333-4333-8333-333333333333"),
  rpc.replace(appPublicId, "app000000002"),
])(
  "rejects a valid token used on another team, project or app: %s",
  async (url) => {
    const awaitedResult1 = await call(post(`${url}/queries`, {}, "session"));
    expect(awaitedResult1.status).toBe(403);
    expect(getByName).not.toHaveBeenCalled();
  }
);

it("rejects sessions without a signed public app identifier", async () => {
  state.verify.mockReturnValue(
    Effect.succeed({ ...identity, appPublicId: undefined })
  );
  const awaitedResult2 = await call(post(`${rpc}/queries`, {}, "session"));
  expect(awaitedResult2.status).toBe(403);
  expect(getByName).not.toHaveBeenCalled();
});

it("authenticates query WebSockets and preserves the protocol while normalizing the path", async () => {
  await call(
    new Request(`${rpc}/queries`, {
      headers: {
        "sec-websocket-protocol": "tailorkit, jwt.session",
        upgrade: "websocket",
      },
    })
  );
  expect(state.verify).toHaveBeenCalledWith("session");
  const [forwarded] = require(fetchInstallation.mock.calls[0]);
  expect(new URL(forwarded.url).pathname).toBe("/rpc/queries");
  expect(forwarded.headers.get("authorization")).toBe("Bearer session");
  expect(forwarded.headers.get("upgrade")).toBe("websocket");
});

it("handles preflight without a token or installation lookup", async () => {
  const response = await call(
    new Request(`${rpc}/queries`, { method: "OPTIONS" })
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-headers")).toContain(
    "authorization"
  );
  expect(state.verify).not.toHaveBeenCalled();
  expect(getByName).not.toHaveBeenCalled();
});

it("accepts authenticated publication only on the internal hostname", async () => {
  const awaitedResult3 = await call(post(publication));
  expect(awaitedResult3.status).toBe(204);
  expect(put).toHaveBeenCalledWith(
    JSON.stringify([projectId, metadata.appId]),
    JSON.stringify(metadata),
    { expirationTtl: 300 }
  );
  put.mockClear();
  const awaitedResult4 = await call(
    post(publication.replace("internal", publicTeamId))
  );
  expect(awaitedResult4.status).toBe(404);
  expect(put).not.toHaveBeenCalled();
});

it.each([
  { projectId: "other" },
  { objectKey: metadata.objectKey.replace(appPublicId, "app000000002") },
  {
    objectKey: metadata.objectKey.replace(
      "/server/server.js",
      "/client/client.js"
    ),
  },
])(
  "rejects publication metadata inconsistent with its URL: %j",
  async (override) => {
    const awaitedResult5 = await call(
      post(publication, { ...metadata, ...override })
    );
    expect(awaitedResult5.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  }
);

it("rejects unauthorized publication and unsupported methods", async () => {
  const awaitedResult6 = await call(post(publication, metadata, "invalid"));
  expect(awaitedResult6.status).toBe(401);
  const awaitedResult7 = await call(new Request(publication));
  expect(awaitedResult7.status).toBe(405);
  expect(put).not.toHaveBeenCalled();
});

it("returns verifier failures without selecting an installation", async () => {
  state.verify.mockReturnValue(
    Effect.fail(new AppError("UNAUTHORIZED", "App token expired"))
  );
  const response = await call(post(`${rpc}/queries`, {}, "session"));
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({
    json: { code: "UNAUTHORIZED", message: "App token expired" },
  });
  expect(getByName).not.toHaveBeenCalled();
});
