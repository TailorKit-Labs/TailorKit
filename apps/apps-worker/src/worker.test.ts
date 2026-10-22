// oxlint-disable-next-line max-classes-per-file -- These related adapter or mock classes implement one runtime boundary.
import { issueAppToken, APP_AUDIENCE } from "@patchsmith/api-utils/app-auth";
import { AppError } from "@patchsmith/app/server";
import { asyncFixture } from "@patchsmith/config/testing";
import { afterAll, beforeEach, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import type { AppFacet } from "./dynamic-workers/facet";
import { PatchsmithAppInstallation } from "./installation";
import type { ServerDeployment } from "./supervisor/source";
import worker from "./worker";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: DurableObjectState;
    env: Env;

    constructor(ctx: DurableObjectState, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
  // oxlint-disable-next-line typescript/no-extraneous-class -- The mock must be constructible because the runtime extends this base class.
  RpcTarget: class {},
  // oxlint-disable-next-line typescript/no-extraneous-class -- The mock must be constructible because the runtime extends this base class.
  WorkerEntrypoint: class {},
}));

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

// Node requires a duplex hint for request streams; workerd does not.
const NativeRequest = globalThis.Request;

vi.stubGlobal(
  "Request",
  class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const options =
        init instanceof NativeRequest
          ? {
              body: init.body,
              duplex: "half",
              headers: init.headers,
              method: init.method,
              signal: init.signal,
            }
          : { ...init, duplex: "half" };

      super(input, options);
    }
  }
);

afterAll(() => vi.unstubAllGlobals());

const source = vi.hoisted(() => ({
  code: vi.fn<() => Promise<string>>(),
  current: vi.fn<() => Promise<ServerDeployment>>(),
}));

const keys = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const signing = {
  audience: APP_AUDIENCE,
  issuer: "https://platform.test/api/platform",
  keyId: "host",
  privateKey: keys.privateKey,
};

const publicKeys = {
  keys: [
    { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "host" },
  ],
};

const identity = {
  appId: "app",
  appShortId: "app000000001",
  deploymentId: "v1",
  installationId: "one",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectShortId: "abc123def456",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "user",
  toolUrl: "https://host.test/api/patchsmith/tools/execute",
};

const checksum = async (code: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code))
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const codeHash = await checksum("code");

const nextHash = await checksum("new code");

const deployment = {
  appId: "app",
  checksum: codeHash,
  contentLength: 4,
  deploymentId: "v1",
  objectKey:
    "projects/abc123def456/apps/app000000001/deployments/deploy000001/server/server.js",
  projectId: "22222222-2222-4222-8222-222222222222",
};

beforeEach(() => {
  vi.clearAllMocks();
  source.current.mockResolvedValue(deployment);
  source.code.mockResolvedValue("code");
});

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const setup = () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(await source.current()))
  );
  let version: string | undefined;

  const facetQuery = vi.fn<AppFacet["query"]>().mockResolvedValue({
    committed: false,
    result: { ok: true, value: "result" },
    tables: [],
  });

  const startup =
    vi.fn<
      (options: {
        modules: Record<string, string>;
        source?: string;
        hostEnv?: { connection?: string };
      }) => void
    >();

  const abort = vi.fn();

  const put = vi.fn((_key: string, value: string) => {
    version = value;
  });

  const get = vi.fn(
    (_name: string, options: () => Parameters<typeof startup>[0]) => {
      startup(options());

      return { query: facetQuery };
    }
  );

  const id = { equals: vi.fn(() => true), toString: () => "installation-id" };
  // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

  const ctx =
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
    {
      facets: { abort, get },
      getWebSockets: () => [],
      id,
      storage: { kv: { get: () => version, put } },
    } as unknown as DurableObjectState;
  /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */

  const getClass = vi.fn(() => "facet-class");

  const load = vi.fn(
    (_name: string, options: () => Parameters<typeof startup>[0]) => {
      startup(options());

      return { getDurableObjectClass: getClass };
    }
  );

  const routeFetch = vi.fn(
    asyncFixture(
      (_request: Request) => new Response("forwarded", { status: 202 })
    )
  );

  const getByName = vi.fn((_name: string) => ({ fetch: routeFetch }));
  const idFromName = vi.fn(() => id);

  // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

  const env =
    /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
    {
      APP_RUNTIME_PUBLIC_KEYS: publicKeys,
      ASSET_DOMAIN: "tailorkit.app",
      BUNDLES: {
        get: async () => ({
          body: requireValue(new Response(await source.code()).body),
        }),
      },

      DEPLOYMENTS: {
        get: vi.fn<() => Promise<null>>().mockResolvedValue(null),
        put: vi.fn<() => Promise<void>>().mockReturnValue(Promise.resolve()),
      },
      LOADER: { get: load },
      PLATFORM_URL: signing.issuer,
      RUNTIME_SERVICE_TOKEN: "private",
      STORES: { getByName, idFromName },
    } as unknown as Env;
  /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */

  return {
    abort,
    ctx,
    env,
    facetQuery,
    get,
    getByName,
    getClass,
    id,
    load,
    put,
    routeFetch,
    startup,
  };
};

const request = async (
  overrides = {},
  path = "/rpc/queries",
  body = '{"json":{"name":"list"}}'
) => {
  const session = await issueAppToken(signing, { ...identity, ...overrides });

  return new Request(`https://runtime.test${path}`, {
    body,
    headers: {
      authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
      origin: "https://host.test",
      "x-patchsmith-identity": "forged",
    },
    method: "POST",
  });
};

// Gateway tests use hosted paths; installation tests retain the private normalized /rpc paths.

const fetchWorker = async (requestValue: Request, env: Env) => {
  const url = new URL(requestValue.url);

  if (url.hostname === "runtime.test" && url.pathname.startsWith("/rpc")) {
    const token = requestValue.headers.get("authorization")?.slice(7);

    const payload =
      token !== undefined && token !== null && token !== ""
        ? z
            .object({ projectShortId: z.string() })
            .parse(
              JSON.parse(
                atob(
                  requireValue(token.split(".")[1])
                    .replaceAll("-", "+")
                    .replaceAll("_", "/")
                )
              )
            )
        : identity;

    url.hostname = `${payload.projectShortId}.tailorkit.app`;
    url.pathname = `/a/${identity.appShortId}${url.pathname}`;
  }

  // SAFETY: This test supplies the context members read by the handler; unrelated request context services are outside this scenario.
  return await worker.fetch(
    new Request(url, requestValue),
    { ...env, ASSET_DOMAIN: env.ASSET_DOMAIN ?? "tailorkit.app" },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
    {} as ExecutionContext
  );
};

it("answers a preflight without accessing authentication or storage", async () => {
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const response = await fetchWorker(
    new Request("https://runtime.test/rpc/queries", { method: "OPTIONS" }),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
    {} as Parameters<typeof worker.fetch>[1]
  );

  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each(["GET", "POST"])(
  "rejects unsupported %s routes before authentication or storage",
  async (method) => {
    const { env, getByName } = setup();

    const response = await fetchWorker(
      new Request("https://runtime.test/server/server.js", { method }),
      env
    );

    expect(response.status).toBe(404);
    expect(getByName).not.toHaveBeenCalled();
  }
);

it.each(["/rpc", "/rpc/query", "/rpc/unknown", "/rpc/queries/extra"])(
  "rejects unknown RPC route %s",
  async (path) => {
    const { env, getByName } = setup();

    const awaitedResult1 = await fetchWorker(
      new Request(`https://runtime.test${path}`, { method: "POST" }),
      env
    );

    expect(awaitedResult1.status).toBe(404);
    expect(getByName).not.toHaveBeenCalled();
  }
);

it.each(["actions", "mutations", "queries"])(
  "forwards authenticated HTTP %s calls",
  async (kind) => {
    const { env, routeFetch } = setup();
    await fetchWorker(await request({}, `/rpc/${kind}`), env);
    expect(requireValue(routeFetch.mock.calls[0])[0].url).toBe(
      `https://${identity.projectShortId}.tailorkit.app/rpc/${kind}`
    );
  }
);

it("requires a token even when any origin is allowed", async () => {
  const { env, getByName } = setup();

  const response = await fetchWorker(
    new Request("https://runtime.test/rpc/queries", {
      headers: { origin: "https://attacker.test" },
      method: "POST",
    }),
    env
  );

  expect(response.status).toBe(401);
  expect(getByName).not.toHaveBeenCalled();
});

it("authenticates and forwards an RPC body with CORS and stable installation routing", async () => {
  const { env, getByName, routeFetch } = setup();
  const response = await fetchWorker(await request(), env);

  expect(response.status).toBe(202);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(getByName).toHaveBeenCalledWith(
    JSON.stringify([signing.issuer, identity.projectId, "app", "one"]),
    { locationHint: "enam" }
  );
  expect(await routeFetch.mock.calls[0][0].text()).toBe(
    '{"json":{"name":"list"}}'
  );
});

it("maps forwarding failures to a sanitized response with allowed-origin CORS", async () => {
  const { env, routeFetch } = setup();
  routeFetch.mockRejectedValueOnce(new Error("private details"));
  const response = await fetchWorker(await request(), env);

  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private details");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
});

it("accepts different signed projects and routes them to distinct installations", async () => {
  const { env, getByName } = setup();

  const awaitedResult2 = await fetchWorker(await request(), env);
  expect(awaitedResult2.status).toBe(202);

  const awaitedResult3 = await fetchWorker(
    await request({
      projectId: "33333333-3333-4333-8333-333333333333",
      projectShortId: "other0000001",
    }),
    env
  );

  expect(awaitedResult3.status).toBe(202);
  expect(getByName.mock.calls.map(([name]) => name)).toEqual([
    JSON.stringify([signing.issuer, identity.projectId, "app", "one"]),
    JSON.stringify([
      signing.issuer,
      "33333333-3333-4333-8333-333333333333",
      "app",
      "one",
    ]),
  ]);
});

it("loads isolated code, passes only the verified identity and caches a warm deployment", async () => {
  const fixtures = setup();

  const installation = new PatchsmithAppInstallation(
    fixtures.ctx,
    fixtures.env
  );

  const response = await installation.fetch(await request());

  expect(await response.json()).toEqual({ json: "result" });
  expect(fixtures.load).toHaveBeenCalledWith(
    `installation-id:v1:${deployment.checksum}`,
    expect.any(Function)
  );
  const [startupOptions] = requireValue(fixtures.startup.mock.calls[0]);
  expect(startupOptions).toMatchObject({
    env: {},
    globalOutbound: null,
    limits: { cpuMs: 10, subRequests: 64 },
    modules: { "application.js": "code" },
  });
  expect(startupOptions.modules["bootstrap.js"]).toEqual(expect.any(String));
  expect(fixtures.get).toHaveBeenCalledWith("app", expect.any(Function));
  expect(fixtures.getClass).toHaveBeenCalledWith("AppFacet");

  expect(fixtures.facetQuery).toHaveBeenCalledWith(
    { name: "list" },
    expect.objectContaining(identity)
  );

  const awaitedResult4 = await installation.fetch(await request());
  await awaitedResult4.text();

  expect(source.current).toHaveBeenCalledTimes(2);
  expect(source.code).toHaveBeenCalledOnce();
  expect(fixtures.put).toHaveBeenCalledOnce();
  expect(fixtures.abort).not.toHaveBeenCalled();
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

it("changes code on the same facet and accepts old client tokens without switching back", async () => {
  const fixtures = setup();

  const installation = new PatchsmithAppInstallation(
    fixtures.ctx,
    fixtures.env
  );

  const awaitedResult5 = await installation.fetch(await request());
  await awaitedResult5.text();

  source.current.mockResolvedValue({
    ...deployment,
    checksum: nextHash,
    contentLength: "new code".length,
    deploymentId: "v2",
  });
  source.code.mockResolvedValue("new code");

  const awaitedResult6 = await installation.fetch(
    await request({ deploymentId: "v2" })
  );

  await awaitedResult6.text();

  expect(fixtures.abort).toHaveBeenCalledOnce();
  expect(fixtures.abort).toHaveBeenCalledWith("app", "App deployment changed");
  expect(fixtures.put).toHaveBeenLastCalledWith("version", `v2:${nextHash}`);
  expect(fixtures.get.mock.calls.every(([name]) => name === "app")).toBe(true);

  const loads = source.code.mock.calls.length;

  const awaitedResult7 = await installation.fetch(await request());
  expect(awaitedResult7.status).toBe(200);
  expect(source.code).toHaveBeenCalledTimes(loads);
  expect(fixtures.abort).toHaveBeenCalledOnce();
  expect(fixtures.put).toHaveBeenCalledTimes(2);
});

it("keeps the running facet when replacement code fails verification", async () => {
  const fixtures = setup();

  const installation = new PatchsmithAppInstallation(
    fixtures.ctx,
    fixtures.env
  );

  const awaitedResult8 = await installation.fetch(await request());
  await awaitedResult8.text();

  source.current.mockResolvedValue({ ...deployment, deploymentId: "v2" });
  source.code.mockRejectedValue(new AppError("NOT_FOUND", "Missing code"));

  const awaitedResult9 = await installation.fetch(
    await request({ deploymentId: "v2" })
  );

  expect(awaitedResult9.status).toBe(404);
  expect(fixtures.abort).not.toHaveBeenCalled();
  expect(fixtures.put).toHaveBeenCalledOnce();
});

it("rechecks authentication and rejects the wrong supervisor before looking up app code", async () => {
  const fixtures = setup();

  const installation = new PatchsmithAppInstallation(
    fixtures.ctx,
    fixtures.env
  );

  const awaitedResult10 = await installation.fetch(
    new Request("https://runtime.test/rpc/queries")
  );

  expect(awaitedResult10.status).toBe(401);

  fixtures.id.equals.mockReturnValue(false);
  const awaitedResult11 = await installation.fetch(await request());
  expect(awaitedResult11.status).toBe(403);
  expect(source.current).not.toHaveBeenCalled();
  expect(fixtures.load).not.toHaveBeenCalled();
});

it("accepts metadata publication only with the shared service credential", async () => {
  const { env, getByName } = setup();
  const deploymentPut = vi.spyOn(env.DEPLOYMENTS, "put");
  env.RUNTIME_SERVICE_TOKEN = "x".repeat(32);

  const publish = async (
    token: string,
    body: z.core.util.JSONType = deployment
  ) =>
    await fetchWorker(
      new Request(
        `https://internal.tailorkit.app/p/${identity.projectId}/a/${identity.appShortId}/new-deployment`,
        {
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          method: "POST",
        }
      ),
      env
    );

  const awaitedResult12 = await publish("wrong");
  expect(awaitedResult12.status).toBe(401);
  const awaitedResult13 = await publish(env.RUNTIME_SERVICE_TOKEN, {});
  expect(awaitedResult13.status).toBe(400);
  const awaitedResult14 = await publish(env.RUNTIME_SERVICE_TOKEN);
  expect(awaitedResult14.status).toBe(204);
  expect(deploymentPut).toHaveBeenCalledWith(
    JSON.stringify([deployment.projectId, deployment.appId]),
    expect.any(String),
    { expirationTtl: 300 }
  );
  const [, publishedMetadata] = requireValue(deploymentPut.mock.calls[0]);

  if (!isStringValue(publishedMetadata)) {
    throw new Error("Expected serialized deployment metadata.");
  }

  expect(JSON.parse(publishedMetadata)).toEqual(deployment);
  expect(getByName).not.toHaveBeenCalled();
});
