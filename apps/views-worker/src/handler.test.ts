import { createHash } from "node:crypto";
import nodePath from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { canonicalizeScope } from "@patchsmith/api-platform/scope";
import {
  APP_AUDIENCE,
  appTokenVerifier,
  installationName,
} from "@patchsmith/api-utils/app-auth";
import { createProjectHostVerifier } from "@patchsmith/auth/project-host";
import { asyncFixture } from "@patchsmith/config/testing";
import { relations } from "@patchsmith/db/relations";
import { app, appDeployment } from "@patchsmith/db/schema/apps";
import { apikey, organization } from "@patchsmith/db/schema/auth";
import { project } from "@patchsmith/db/schema/project";
import type { SecondaryStorage } from "better-auth";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterEach, expect, it } from "vite-plus/test";

import { readEnv } from "#env";

import {
  projectKey,
  readInput,
  resolutionPath,
  resolveRequest,
} from "./handler";
import worker from "./index";

const issuer = "https://patchsmith.io/api/platform";
const scope = { name: "workspace", value: { id: "authorized" } };
const otherScope = { name: "workspace", value: { id: "other" } };
const key = "tk_proj_test-only-project-key-that-is-long-enough-for-validation";
const organizationId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const otherProjectId = crypto.randomUUID();
const appId = crypto.randomUUID();
const deploymentId = crypto.randomUUID();

const input = {
  contexts: [
    { context: { viewer: "viewer" }, path: "/", status: "ready" as const },
  ],
  scopes: [scope],
  slot: "sidebar",
  subjectId: "viewer",
  toolUrl: "https://any-host.test/api/patchsmith/tools/execute",
};

const request = (token = key) =>
  new Request(`https://views.test${resolutionPath}`, {
    body: JSON.stringify(input),
    headers: { authorization: `Bearer ${token}` },
    method: "POST",
  });

const clients: PGlite[] = [];

afterEach(async () => {
  await Promise.all(
    clients.splice(0).map(async (client) => {
      await client.close();
    })
  );
});

const projectKeyForRuntime = (runtimeRequest: Request) =>
  runtimeRequest.headers.get("authorization")?.slice(7) ?? "";

const setup = async () => {
  const client = new PGlite();
  clients.push(client);
  const database = drizzle({ client, relations });
  await migrate(database, {
    migrationsFolder: nodePath.resolve(
      import.meta.dirname,
      "../../../packages/db/src/migrations"
    ),
  });
  await database.insert(organization).values({
    createdAt: new Date(),
    id: organizationId,
    name: "Test",
    shortId: "team00000001",
    slug: "test",
  });
  await database.insert(project).values([
    {
      id: projectId,
      name: "Test",
      organizationId,
      shortId: "proj00000001",
      slug: "test",
    },
    {
      id: otherProjectId,
      name: "Other",
      organizationId,
      shortId: "proj00000002",
      slug: "other",
    },
  ]);
  await database.insert(apikey).values({
    configId: "project-host",
    createdAt: new Date(),
    key: createHash("sha256").update(key).digest("base64url"),
    metadata: JSON.stringify({ projectId }),
    rateLimitEnabled: false,
    referenceId: organizationId,
    updatedAt: new Date(),
  });

  await Promise.all(
    (
      [
        [appId, projectId, scope],
        [crypto.randomUUID(), projectId, otherScope],
        [crypto.randomUUID(), otherProjectId, scope],
      ] as const
    ).map(async ([id, owner, installationScope]) => {
      await database.insert(app).values({
        id,
        name: "Test",
        projectId: owner,
        ...canonicalizeScope(installationScope),
      });
      const deployment = id === appId ? deploymentId : crypto.randomUUID();
      await database.insert(appDeployment).values({
        appId: id,
        id: deployment,
        status: "published",
        views: [{ instances: true, path: "/", slot: "sidebar" }],
      });
      await database
        .update(app)
        .set({ currentDeploymentId: deployment })
        .where(eq(app.id, id));
    })
  );

  const values = new Map<string, string>();

  const secondaryStorage: SecondaryStorage = {
    delete: asyncFixture((name) => {
      values.delete(name);
    }),
    get: asyncFixture((name) => values.get(name) ?? null),
    getAndDelete: asyncFixture((name) => {
      const value = values.get(name) ?? null;
      values.delete(name);

      return value;
    }),
    increment: asyncFixture((name) => {
      const value = Number(values.get(name) ?? 0) + 1;
      values.set(name, String(value));

      return value;
    }),
    set: asyncFixture((name, value) => {
      values.set(name, value);
    }),
  };

  const authOptions = {
    baseURL: issuer,
    database,
    secondaryStorage,
    secret: "test-only-shared-auth-secret-at-least-32-characters",
  };

  const auth = createProjectHostVerifier(authOptions);

  const signingKeys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const publicKey = await crypto.subtle.exportKey("jwk", signingKeys.publicKey);

  const signing = {
    issuer,
    keyId: "test-key",
    privateKey: signingKeys.privateKey,
  };

  const verifyToken = appTokenVerifier({
    audience: APP_AUDIENCE,
    issuer,
    publicKeys: { keys: [{ ...publicKey, kid: "test-key" }] },
  });

  const calls: { name: string; request: Request }[] = [];
  const limitedOrganizations: string[] = [];

  const services: Parameters<typeof resolveRequest>[2] = {
    assetDomain: "tailorkit.app",
    database,
    limit: asyncFixture((id) => {
      limitedOrganizations.push(id);

      return true;
    }),
    signing,
    stores: {
      getByName: (name) => ({
        fetch: async (runtimeRequest) => {
          calls.push({ name, request: runtimeRequest });

          const identity = await verifyToken(
            projectKeyForRuntime(runtimeRequest)
          );

          expect(identity).toMatchObject({
            appId,
            deploymentId,
            installationId: appId,
            projectId,
            scope,
            subjectId: "viewer",
            toolUrl: input.toolUrl,
          });
          await runtimeRequest.clone().json();

          return Response.json(
            {
              json: [
                {
                  data: { id: "row" },
                  key: "result",
                  metadata: { title: "Result" },
                },
              ],
            },
            { headers: { "server-timing": "runtime_installation;dur=4.0" } }
          );
        },
      }),
    },
    verifyKey: async (token) =>
      await auth.api.verifyApiKey({
        body: { configId: "project-host", key: token },
      }),
  };

  return {
    auth,
    authOptions,
    calls,
    database,
    limitedOrganizations,
    services,
    values,
  };
};

it("uses shared project-key verification, scoped Postgres discovery, and the original installation identity", async () => {
  const { authOptions, calls, limitedOrganizations, services, values } =
    await setup();

  const response = await resolveRequest(request(), input, services);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("server-timing")).toContain(
    "runtime_installation_max;dur=4.0"
  );
  expect(await response.json()).toMatchObject({
    data: [{ app: { id: appId }, data: { id: "row" }, key: "result" }],
    status: "ready",
    warnings: [],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.name).toBe(
    installationName({ appId, installationId: appId, projectId }, issuer)
  );
  expect(new URL(calls[0]?.request.url ?? "").pathname).toBe("/rpc/actions");
  expect(limitedOrganizations).toEqual([organizationId]);
  expect(values.size).toBeGreaterThan(0);
  // A separately constructed backend uses the same cache and key configuration.
  const anotherBackend = createProjectHostVerifier(authOptions);

  const verification = await anotherBackend.api.verifyApiKey({
    body: { configId: "project-host", key },
  });

  expect(verification.valid).toBe(true);
});

it("returns no instances for foreign scopes and filters, and enforces the organization limiter", async () => {
  const { calls, services } = await setup();

  const response = await resolveRequest(
    request(),
    { ...input, appIds: ["invalid-id", crypto.randomUUID()] },
    services
  );

  expect(await response.json()).toEqual({
    data: [],
    status: "ready",
    warnings: [],
  });
  expect(calls).toHaveLength(0);
  await expect(
    resolveRequest(request(), input, {
      ...services,
      limit: asyncFixture(() => false),
    })
  ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
});

it("rejects a disabled database key after cache invalidation and prevents cross-organization metadata", async () => {
  const { database, services, values } = await setup();
  await resolveRequest(request(), input, services);
  values.clear();
  await database.update(apikey).set({ enabled: false });
  await expect(
    resolveRequest(request(), input, services)
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await database
    .update(apikey)
    .set({ enabled: true, referenceId: crypto.randomUUID() });
  values.clear();
  await expect(
    resolveRequest(request(), input, services)
  ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("rejects other credentials, malformed input, and unrelated routes before connecting", async () => {
  expect(() => projectKey(request("runtime-service-token"))).toThrow();
  expect(() => projectKey(request("agent.jwt.token"))).toThrow();
  await expect(
    readInput(
      new Request("https://views.test", {
        body: JSON.stringify({ ...input, projectId }),
        method: "POST",
      })
    )
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });

  const response = await worker.fetch(
    new Request("https://views.test/api/platform/apps/list"),
    {}
  );

  expect(response.status).toBe(404);
  const unauthorized = await worker.fetch(request("wrong-key"), {});
  expect(unauthorized.status).toBe(401);

  const oversized = new Request("https://views.test", {
    body: "x".repeat(1_048_577),
    method: "POST",
  });

  await expect(readInput(oversized)).rejects.toMatchObject({
    code: "PAYLOAD_TOO_LARGE",
  });
});

it("parses request bindings without reading or modifying a process-wide database URL", async () => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const privateKey = await crypto.subtle.exportKey("jwk", keys.privateKey);

  const bindings = {
    APP_RUNTIME_SIGNING_KEY: JSON.stringify({ ...privateKey, kid: "test" }),
    AUTH_SECRET: "test-only-shared-auth-secret-at-least-32-characters",
    HYPERDRIVE: { connectionString: "postgres://localhost/request-one" },
    KV_REST_API_TOKEN: "test",
    KV_REST_API_URL: "https://redis.test",
    STORES: {
      getByName: () => ({ fetch: asyncFixture(() => new Response()) }),
    },
  };

  expect(readEnv(bindings).HYPERDRIVE.connectionString).toBe(
    "postgres://localhost/request-one"
  );
  expect(
    readEnv({
      ...bindings,
      HYPERDRIVE: { connectionString: "postgres://localhost/request-two" },
    }).HYPERDRIVE.connectionString
  ).toBe("postgres://localhost/request-two");
  expect(readEnv(bindings).APP_RUNTIME_SIGNING_KEY.kid).toBe("test");
});
