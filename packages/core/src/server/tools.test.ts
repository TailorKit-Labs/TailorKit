import { expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { defineContract } from "../schema/contract";
import { tool } from "../schema/tools";
import { createServer } from "./contract";
import { createToolVerifier } from "./tool-auth";

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
const issuer = "https://platform.test/api/platform";
const toolUrl = "https://product.test/api/tailorkit/tools/execute";
const identity = {
  appId: "app",
  deploymentId: "deployment",
  installationId: "app",
  projectId: "project",
  scope: { name: "org", value: { id: "tenant" } },
  subjectId: "automation:billing",
};
const handler = vi.fn(({ input, context }) => ({
  principal: context.identity.subjectId ?? context.identity.installationId,
  value: input + 1,
}));
const contract = defineContract({
  scopes: { org: z.object({ id: z.string() }) },
  tools: {
    math: {
      broken: tool.server().output(z.number()),
      increment: tool
        .server()
        .input(z.string().transform(Number))
        .output(z.object({ value: z.number(), principal: z.string() })),
      transformed: tool
        .server()
        .output(z.string().transform(Number).pipe(z.number())),
    },
    ui: { open: tool.client().input(z.string()).output(z.string()) },
  },
});
const server = createServer({
  $internal: {
    platformBaseUrl: issuer,
    platformFetch: async (url, init) => {
      if (String(url).endsWith("/runtime/keys"))
        return Response.json({ keys: [{ ...jwk, kid: "platform" }] });
      const request = url instanceof Request ? url : new Request(url, init);
      expect(request.headers.get("authorization")).toBe(
        "Bearer product-project-key"
      );
      expect(request.url).toBe(issuer + "/apps/app/lookup");
      expect(await request.json()).toEqual({ scopes: [identity.scope] });
      return Response.json({
        id: "app",
        projectId: "project",
        currentDeployment: { id: "deployment" },
      });
    },
    platformHeaders: { authorization: "Bearer product-project-key" },
  },
  baseUrl: "https://product.test/api/tailorkit",
  contract,
  tools: {
    math: {
      broken: () => "invalid" as unknown as number,
      increment: handler,
      transformed: () => "42",
    },
  },
});
it.each([
  undefined,
  "",
  "/api/tailorkit",
  "//product.test/api/tailorkit",
  "ftp://product.test/api/tailorkit",
])(
  "requires an absolute HTTP(S) base URL when creating a server: %s",
  (baseUrl) => {
    expect(() =>
      createServer({ baseUrl: baseUrl as string, contract: defineContract({}) })
    ).toThrow();
  }
);

it("uses the authentication supplied for each handler call", async () => {
  const fetchApps = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      items: [],
      pagination: { hasMore: false, page: 1, pageSize: 100 },
    })
  );
  const host = createServer({
    $internal: { platformFetch: fetchApps },
    baseUrl: "https://product.test/api/tailorkit",
    contract: defineContract({ scopes: { org: z.object({ id: z.string() }) } }),
  });
  const request = new Request("https://product.test/api/tailorkit/apps");
  const denied = await host.handler(request, { authenticate: () => null });
  expect(denied.status).toBe(401);
  expect(fetchApps).not.toHaveBeenCalled();
  const authenticate = vi.fn(() => ({ scopes: { org: { id: "tenant" } } }));
  const allowed = await host.handler(request, { authenticate });
  expect(allowed.status).toBe(200);
  expect(authenticate).toHaveBeenCalledWith({ request });
  expect(fetchApps).toHaveBeenCalledOnce();
});

const encode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
async function token(
  overrides: Record<string, unknown> = {},
  privateKey = pair.privateKey,
  kid = "platform"
) {
  const now = Math.floor(Date.now() / 1000);
  const data = new TextEncoder();
  const header = encode(
    data.encode(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }))
  );
  const body = encode(
    data.encode(
      JSON.stringify({
        ...identity,
        appPublicId: "public-app",
        aud: "tailorkit-app",
        exp: now + 300,
        iat: now,
        iss: issuer,
        publicTeamId: "team",
        sub: identity.installationId,
        toolUrl,
        ...overrides,
      })
    )
  );
  return `${header}.${body}.${encode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        privateKey,
        data.encode(header + "." + body)
      )
    )
  )}`;
}
async function execute(
  credential: string,
  path = "math.increment",
  ...args: [input?: unknown]
) {
  const input = args.length ? args[0] : "41";
  return server.handler(
    new Request(toolUrl, {
      body: JSON.stringify({
        path,
        input,
        requestId: "1a5febf3-e3af-4a01-89a7-35a4f1846114",
      }),
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      method: "POST",
    }),
    { authenticate: () => null }
  );
}
it("validates transformed inputs and exposes verified installation, principal, scope and request ID", async () => {
  const response = await execute(await token());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    output: { principal: identity.subjectId, value: 42 },
  });
  expect(handler.mock.calls.at(-1)?.[0]).toMatchObject({
    context: {
      identity,
      requestId: "1a5febf3-e3af-4a01-89a7-35a4f1846114",
      scope: identity.scope,
    },
    input: 41,
  });
});
it("attributes a call without a subject to its installation", async () => {
  const response = await execute(await token({ subjectId: undefined }));
  expect(await response.json()).toEqual({
    output: { principal: "app", value: 42 },
  });
});
it.each([
  { iss: "https://attacker.test" },
  { aud: "another-service" },
  { toolUrl: "https://other.test/tools" },
  { exp: 1 },
  () => ({ exp: Math.floor(Date.now() / 1000) + 601 }),
  () => ({ iat: Math.floor(Date.now() / 1000) + 1 }),
  { scope: { name: "other", value: {} } },
  { subjectId: 123 },
  { projectId: "other-project" },
  { deploymentId: "unpublished" },
  { installationId: "victim" },
])("rejects invalid signed claims %j", async (claims) => {
  const before = handler.mock.calls.length;
  expect(
    (
      await execute(
        await token(typeof claims === "function" ? claims() : claims)
      )
    ).status
  ).toBe(401);
  expect(handler.mock.calls.length).toBe(before);
});
it("rejects a signature from an untrusted key", async () => {
  const attacker = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  expect((await execute(await token({}, attacker.privateKey))).status).toBe(
    401
  );
});
it("validates both directions and dispatches only declared server tools", async () => {
  expect((await execute(await token(), "math.increment", {})).status).toBe(400);
  expect((await execute(await token(), "math.broken")).status).toBe(500);
  expect((await execute(await token(), "ui.open")).status).toBe(404);
});
it("serializes nested kinds and schemas without implementations", () => {
  const metadata = server.$internal.schema.serialize();
  expect(metadata.tools).toMatchObject({
    math: { increment: { kind: "server", output: { type: "object" } } },
    ui: { open: { input: { type: "string" }, kind: "client" } },
  });
  expect(JSON.stringify(metadata)).not.toContain("handler");
});
it("permits sandbox HTTP preflights without cookie credentials", async () => {
  const response = await server.handler(
    new Request(toolUrl, {
      headers: {
        "access-control-request-headers": "authorization,content-type",
        "access-control-request-method": "POST",
        origin: "null",
      },
      method: "OPTIONS",
    }),
    { authenticate: () => null }
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(response.headers.get("access-control-allow-headers")).toContain(
    "authorization"
  );
});

it("validates and transforms implementation output before returning it to callers", async () => {
  const response = await execute(await token(), "math.transformed");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ output: 42 });
});

it("accepts the same app session JWT across declared server tools", async () => {
  const session = await token();
  expect((await execute(session)).status).toBe(200);
  expect(await (await execute(session, "math.transformed")).json()).toEqual({
    output: 42,
  });
});

it("uses the trusted public origin to verify tool destinations behind a proxy", async () => {
  const proxied = createServer({
    $internal: {
      platformBaseUrl: issuer,
      platformFetch: async (url) =>
        String(url).endsWith("/runtime/keys")
          ? Response.json({ keys: [{ ...jwk, kid: "platform" }] })
          : Response.json({
              id: "app",
              projectId: "project",
              currentDeployment: { id: "deployment" },
            }),
    },
    baseUrl: new URL("https://product.test/custom/tailorkit/"),
    contract,
    tools: {
      math: { broken: () => 0, increment: handler, transformed: () => "42" },
    },
  });
  const internalUrl = "http://internal:3000/custom/tailorkit/tools/execute";
  const request = (credential: string) =>
    new Request(internalUrl, {
      body: JSON.stringify({
        path: "math.increment",
        input: "41",
        requestId: crypto.randomUUID(),
      }),
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  expect(
    (
      await proxied.handler(
        request(
          await token({
            toolUrl: "https://product.test/custom/tailorkit/tools/execute",
          })
        ),
        { authenticate: () => null }
      )
    ).status
  ).toBe(200);
  expect(
    (
      await proxied.handler(request(await token({ toolUrl: internalUrl })), {
        authenticate: () => null,
      })
    ).status
  ).toBe(401);
});

it("refreshes once for a rotated key, coalesces requests and throttles unknown key IDs", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const rotated = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const rotatedJwk = await crypto.subtle.exportKey("jwk", rotated.publicKey);
    const fetchKeys = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ keys: [{ ...jwk, kid: "platform" }] })
      )
      .mockImplementation(async () =>
        Response.json({ keys: [{ ...rotatedJwk, kid: "rotated" }] })
      );
    const verify = createToolVerifier({
      fetch: fetchKeys,
      platformUrl: issuer,
    });
    await verify(await token(), toolUrl);
    const credential = await token({}, rotated.privateKey, "rotated");
    await Promise.all([
      verify(credential, toolUrl),
      verify(credential, toolUrl),
    ]);
    expect(fetchKeys).toHaveBeenCalledTimes(2);
    for (const kid of ["forged-a", "forged-b"]) {
      await expect(
        verify(await token({}, pair.privateKey, kid), toolUrl)
      ).rejects.toThrow("Unknown signing key");
    }
    expect(fetchKeys).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(9999);
    await expect(
      verify(await token({}, pair.privateKey, "forged-c"), toolUrl)
    ).rejects.toThrow("Unknown signing key");
    expect(fetchKeys).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    await expect(
      verify(await token({}, pair.privateKey, "forged-d"), toolUrl)
    ).rejects.toThrow("Unknown signing key");
    expect(fetchKeys).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60_000);
    await verify(await token({}, rotated.privateKey, "rotated"), toolUrl);
    expect(fetchKeys).toHaveBeenCalledTimes(4);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps valid cached keys when a refresh returns invalid keys, and still expires them", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const fetchKeys = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ keys: [{ ...jwk, kid: "platform" }] })
      )
      .mockImplementation(async () =>
        Response.json({ keys: [{ ...jwk, d: "private", kid: "rotated" }] })
      );
    const verify = createToolVerifier({
      fetch: fetchKeys,
      platformUrl: issuer,
    });
    const credential = await token();
    await verify(credential, toolUrl);
    await expect(
      verify(await token({}, pair.privateKey, "rotated"), toolUrl)
    ).rejects.toThrow("Invalid signing keys");
    await verify(credential, toolUrl);
    expect(fetchKeys).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    await expect(verify(credential, toolUrl)).rejects.toThrow(
      "Invalid signing keys"
    );
    expect(fetchKeys).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it("rejects an unknown key after one fetch when the key cache is empty", async () => {
  const fetchKeys = vi
    .fn<typeof fetch>()
    .mockImplementation(async () =>
      Response.json({ keys: [{ ...jwk, kid: "platform" }] })
    );
  const verify = createToolVerifier({ fetch: fetchKeys, platformUrl: issuer });
  await expect(
    verify(await token({}, pair.privateKey, "forged"), toolUrl)
  ).rejects.toThrow("Unknown signing key");
  expect(fetchKeys).toHaveBeenCalledTimes(1);
});
