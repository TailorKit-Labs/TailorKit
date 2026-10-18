import { AppError } from "@tailorkit/app/server";
import { asyncFixture } from "@tailorkit/config/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { z } from "zod";

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

const projectShortId = "abc123def456";

const appShortId = "app000000001";

const rpc = `https://${projectShortId}.tailorkit.app/a/${appShortId}/rpc`;

const publication = `https://internal.tailorkit.app/p/${projectId}/a/${appShortId}/new-deployment`;

const secret = "s".repeat(32);

const identity = {
  appId: "private-app",
  appShortId,
  installationId: "installation",
  projectId,
  projectShortId,
};

const metadata = {
  appId: "private-app",
  checksum: "a".repeat(64),
  contentLength: 100,
  deploymentId: "private-deployment",
  objectKey: `projects/${projectShortId}/apps/${appShortId}/deployments/deploy000001/server/server.js`,
  projectId,
};

const fetchInstallation = vi.fn(
  asyncFixture((_request: Request) => new Response("result"))
);

const getByName = vi.fn(() => ({ fetch: fetchInstallation }));

const put = vi.fn<() => Promise<void>>().mockReturnValue(Promise.resolve());

// SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

const env =
  /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
  {
    ASSET_DOMAIN: "tailorkit.app",
    DEPLOYMENTS: { put },
    PLATFORM_URL: "https://platform.test/api/platform",
    RUNTIME_SERVICE_TOKEN: secret,
    STORES: { getByName },
  } as unknown as Env;
/* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */

// SAFETY: This test supplies the context members read by the handler; unrelated request context services are outside this scenario.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
const ctx = {} as ExecutionContext;

const call = async (request: Request) => await worker.fetch(request, env, ctx);

const post = (
  url: string,
  body: z.core.util.JSONType = metadata,
  token = secret
) =>
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
  rpc.replace(projectShortId, "xyz123def456"),
  rpc.replace(appShortId, "app000000002"),
])("rejects a valid token used on another project or app: %s", async (url) => {
  const awaitedResult1 = await call(post(`${url}/queries`, {}, "session"));
  expect(awaitedResult1.status).toBe(403);
  expect(getByName).not.toHaveBeenCalled();
});

it("rejects sessions without a signed public app identifier", async () => {
  state.verify.mockReturnValue(
    Effect.succeed({ ...identity, appShortId: undefined })
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
    post(publication.replace("internal", projectShortId))
  );
  expect(awaitedResult4.status).toBe(404);
  expect(put).not.toHaveBeenCalled();
});

it.each([
  { projectId: "other" },
  { objectKey: metadata.objectKey.replace(appShortId, "app000000002") },
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
