import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createTailorKitClient } from "./client";
import { createTailorKitServer } from "./handler";

const testScopeSchema = z.record(z.string(), z.string().min(1));
const tailor = createTailorKitServer({
  baseUrl: "https://example.com/api/tailorkit",
  components: {},
  scopes: { org: testScopeSchema },
});
const optionalSchemaTailor = tailor;

const authenticateImplementation2Implementation = () => ({
  scopes: { org: { tenant: "workspace" } },
});

const authenticateImplementationImplementation = () => ({
  scopes: {
    org: { tenant: "org" },
    userOrg: { tenant: "user_org" },
  },
});

const requestImplementationImplementation = (origin: string) =>
  new Request("http://internal:3000/custom/tailorkit/backend/session", {
    body: JSON.stringify({ appId: "app" }),
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-host": "attacker.test",
      "x-forwarded-proto": "https",
    },
    method: "POST",
  });

describe("createTailorKitServer", () => {
  it("requests app backend tokens from the platform with host credentials and verified scopes", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
        platformFetch: async (input, init) => {
          requests.push(
            input instanceof Request ? input : new Request(input, init)
          );
          return Response.json({
            expiresAt: 123,
            token: "platform-token",
            url: "https://runtime.test/rpc",
          });
        },
      },
      baseUrl: "https://host.test/api/tailorkit",
      components: {},
      projectKey: "project-key",
      scopes: { org: testScopeSchema },
    });
    const response = await server.handler(
      new Request("https://host.test/api/tailorkit/backend/session", {
        body: JSON.stringify({ appId: "app" }),
        headers: {
          "content-type": "application/json",
          origin: "https://host.test",
        },
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { tenant: "verified" } } }) }
    );
    expect(await response.json()).toEqual({
      expiresAt: 123,
      token: "platform-token",
      url: "https://runtime.test/rpc",
    });
    const [issuedRequest] = requests;
    if (!issuedRequest) {
      throw new Error("Expected a platform token request");
    }
    expect(issuedRequest.url).toBe(
      "https://tailorkit.dev/api/platform/apps/app/runtime/session"
    );
    expect(issuedRequest.headers.get("authorization")).toBe(
      "Bearer project-key"
    );
    expect(await issuedRequest.json()).toEqual({
      scopes: [{ name: "org", value: { tenant: "verified" } }],
      toolUrl: "https://host.test/api/tailorkit/tools/execute",
    });
  });

  const requestImplementation = requestImplementationImplementation;

  it("issues the public tool destination and checks the browser origin behind a proxy", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
        platformFetch: async (input, init) => {
          requests.push(
            input instanceof Request ? input : new Request(input, init)
          );
          return Response.json({
            expiresAt: 123,
            token: "platform-token",
            url: "https://runtime.test/rpc",
          });
        },
      },
      baseUrl: "https://host.test/custom/tailorkit/",
      components: {},
      projectKey: "project-key",
      scopes: { org: testScopeSchema },
    });
    const request = requestImplementation;
    const authentication = {
      authenticate: () => ({ scopes: { org: { tenant: "verified" } } }),
    };
    const awaitedResult1 = await server.handler(
      request("https://host.test"),
      authentication
    );
    expect(awaitedResult1.status).toBe(200);
    expect(await requests[0]?.json()).toMatchObject({
      toolUrl: "https://host.test/custom/tailorkit/tools/execute",
    });
    const awaitedResult2 = await server.handler(
      request("https://attacker.test"),
      authentication
    );
    expect(awaitedResult2.status).toBe(400);
    const awaitedResult3 = await server.handler(
      request("http://internal:3000"),
      authentication
    );
    expect(awaitedResult3.status).toBe(400);
    expect(requests).toHaveLength(1);
  });

  it.each([
    {
      baseUrl: "http://localhost:3000/api/tailorkit",
      origin: "http://localhost:3000",
      prefix: "/api/tailorkit",
    },
    {
      baseUrl: "https://public.test/custom/routes///",
      origin: "https://public.test",
      prefix: "/custom/routes",
    },
    {
      baseUrl: new URL("https://public.test:8443/custom/routes/"),
      origin: "https://public.test:8443",
      prefix: "/custom/routes",
    },
    {
      baseUrl: "https://public.test/",
      origin: "https://public.test",
      prefix: "",
    },
  ])(
    "routes and issues sessions from baseUrl=$baseUrl",
    async ({ baseUrl, prefix, origin }) => {
      const bodies: unknown[] = [];
      const server = createTailorKitServer({
        $internal: {
          platformFetch: async (input, init) => {
            bodies.push(
              await (
                input instanceof Request ? input : new Request(input, init)
              ).json()
            );
            return Response.json({
              expiresAt: 123,
              token: "token",
              url: "https://runtime.test/rpc",
            });
          },
        },
        baseUrl,
        components: {},
        scopes: { org: testScopeSchema },
      });
      const authentication = {
        authenticate: () => ({ scopes: { org: { tenant: "verified" } } }),
      };
      for (const route of ["schema", "meta"]) {
        // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
        const awaitedResult4 = await server.handler(
          new Request(`https://request.test${prefix}/${route}`),
          authentication
        );
        expect(awaitedResult4.status).toBe(200);
      }
      const response = await server.handler(
        new Request(`https://request.test${prefix}/backend/session`, {
          body: JSON.stringify({ appId: "app" }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        }),
        authentication
      );
      expect(response.status).toBe(200);
      expect(bodies).toEqual([
        {
          scopes: [{ name: "org", value: { tenant: "verified" } }],
          toolUrl: `${origin + prefix}/tools/execute`,
        },
      ]);
    }
  );

  it.each([
    undefined,
    null,
    "",
    "/",
    "/api/tailorkit",
    "https:host.test/api",
    "https:/host.test/api",
    "https:///host.test/api",
    "//attacker.test/api",
    "api/relative",
    "ftp://host.test/api",
    "https://user:password@host.test/api",
    "/api?query=1",
    "https://host.test/api#fragment",
    "/api\\path",
    " /api",
  ])("rejects an ambiguous or invalid baseUrl=%s", (baseUrl) => {
    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
    expect(() =>
      createTailorKitServer({
        // oxlint-disable-next-line typescript/no-non-null-assertion -- Parameterized negative cases deliberately pass invalid inputs through the public API.
        baseUrl: baseUrl!,
        components: {},
        scopes: { org: testScopeSchema },
      })
    ).toThrow();
  });

  it("returns platform scope denials without issuing a backend session", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
        platformFetch: async (input, init) => {
          requests.push(
            input instanceof Request ? input : new Request(input, init)
          );
          return Response.json(
            { code: "NOT_FOUND", message: "Not found" },
            { status: 404 }
          );
        },
      },
      baseUrl: "https://host.test/api/tailorkit",
      components: {},
      projectKey: "project-key",
      scopes: { org: testScopeSchema },
    });
    const response = await server.handler(
      new Request("https://host.test/api/tailorkit/backend/session", {
        body: JSON.stringify({ appId: "not-in-scope" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { tenant: "verified" } } }) }
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(requests).toHaveLength(1);
  });

  const authenticateImplementation = authenticateImplementationImplementation;

  it("selects only requested authenticated scope names for host app reads", async () => {
    const platformBodies: unknown[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformFetch: async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          platformBodies.push(await request.json());
          return Response.json({
            items: [],
            pagination: { hasMore: false, page: 1, pageSize: 100 },
          });
        },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: { org: testScopeSchema, userOrg: testScopeSchema },
    });
    const authenticate = authenticateImplementation;

    const response = await server.handler(
      new Request(
        "https://example.com/api/tailorkit/apps?scopes=userOrg&scopes=userOrg"
      ),
      { authenticate }
    );
    expect(response.status).toBe(200);
    expect(platformBodies).toEqual([
      {
        page: 1,
        pageSize: 100,
        scopes: [{ name: "userOrg", value: { tenant: "user_org" } }],
      },
    ]);

    const invalid = await server.handler(
      new Request("https://example.com/api/tailorkit/apps?scopes=missing"),
      { authenticate }
    );
    expect(invalid.status).toBe(400);
    expect(platformBodies).toHaveLength(1);
  });

  const authenticateImplementation2 = authenticateImplementation2Implementation;

  it("treats scopes= as an empty app and preview selection", async () => {
    let platformCalls = 0;
    const server = createTailorKitServer({
      $internal: {
        // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
        platformFetch: async () => {
          platformCalls += 1;
          return Response.json({ items: [] });
        },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: { org: testScopeSchema },
    });
    const authenticate = authenticateImplementation2;
    const apps = await server.handler(
      new Request("https://example.com/api/tailorkit/apps?scopes="),
      { authenticate }
    );
    expect(apps.status).toBe(200);
    await expect(apps.json()).resolves.toEqual([]);

    const metadata = await server.handler(
      new Request(
        "https://example.com/api/tailorkit/preview/metadata?sessionId=test&scopes="
      ),
      { authenticate }
    );
    expect(metadata.status).toBe(404);
    expect(platformCalls).toBe(0);
  });

  it("preserves hosted bundle URLs", async () => {
    const app = {
      clientPath:
        "https://abc123def4.tailorkit.app/p/22222222-2222-4222-8222-222222222222/a/33333333-3333-4333-8333-333333333333/d/44444444-4444-4444-8444-444444444444/client.js",
      id: "app",
    };
    const server = createTailorKitServer({
      $internal: {
        // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
        platformFetch: async () =>
          Response.json({
            items: [app],
            pagination: { hasMore: false, page: 1, pageSize: 100 },
          }),
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      projectKey: "server-only-key",
      scopes: { org: testScopeSchema },
    });
    const response = await server.handler(
      new Request("https://host.test/api/tailorkit/apps"),
      {
        authenticate: () => ({ scopes: { org: { tenant: "workspace" } } }),
      }
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([app]);
  });
  it("serves the serialized schema from the handler", async () => {
    const response = await optionalSchemaTailor.handler(
      new Request("https://example.com/api/tailorkit/schema"),
      { authenticate: () => ({ scopes: { org: { tenant: "test" } } }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      components: {},
      tools: {},
      version: 1,
    });
  });

  it("serves a built-in CLI auth approval page", async () => {
    const response = await optionalSchemaTailor.handler(
      new Request(
        "https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"
      ),
      { authenticate: () => ({ scopes: { org: { tenant: "test" } } }) }
    );

    const html = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Approve CLI login");
    expect(html).toContain('value="ABC-123-XYZ"');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("redirects unauthenticated CLI approvals to the host sign-in page", async () => {
    const server = createTailorKitServer({
      baseUrl: "https://example.com/api/tailorkit",
      cliAuth: { signInPath: "/admin/sign-in?source=tailorkit" },
      components: {},
      scopes: { org: testScopeSchema },
    });
    const response = await server.handler(
      new Request(
        "https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"
      ),
      { authenticate: () => null }
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("location")).toBe(
      "https://example.com/admin/sign-in?source=tailorkit&returnTo=%2Fapi%2Ftailorkit%2Fcli-auth%2Fapprove%3Fcode%3DABC-123-XYZ"
    );
  });

  it("renders configured CLI approvals for authenticated users", async () => {
    const server = createTailorKitServer({
      baseUrl: "https://example.com/api/tailorkit",
      cliAuth: { signInPath: "/admin/sign-in" },
      components: {},
      scopes: { org: testScopeSchema, userOrg: testScopeSchema },
    });
    const response = await server.handler(
      new Request(
        "https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"
      ),
      {
        authenticate: () => ({
          scopes: { org: { tenant: "test" }, userOrg: { tenant: "user" } },
        }),
      }
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Approve CLI login");
    expect(html).toContain('<form method="post">');
    expect(html).toContain('name="scope" required');
    expect(html).not.toContain('<form method="post" novalidate>');
  });

  it("preserves the scope selection when a CLI approval code is missing", async () => {
    const server = createTailorKitServer({
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: { org: testScopeSchema, userOrg: testScopeSchema },
    });
    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve", {
        body: new URLSearchParams({
          intent: "approve",
          scope: "userOrg",
          userCode: "",
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
      {
        authenticate: () => ({
          scopes: { org: { tenant: "test" }, userOrg: { tenant: "user" } },
        }),
      }
    );

    const html = await response.text();
    expect(html).toContain("Enter the code shown in your terminal.");
    expect(html).toContain('<option value="org">org</option>');
    expect(html).toContain('<option value="userOrg" selected>userOrg</option>');
  });

  it("rejects cross-origin CLI sign-in redirects", async () => {
    const server = createTailorKitServer({
      baseUrl: "https://example.com/api/tailorkit",
      cliAuth: { signInPath: "//evil.example/sign-in" },
      components: {},
      scopes: { org: testScopeSchema },
    });

    await expect(
      server.handler(
        new Request(
          "https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"
        ),
        { authenticate: () => null }
      )
    ).rejects.toThrow(
      "TailorKit cliAuth.signInPath must be a same-origin path."
    );
  });

  it("rejects host scopes that fail Standard Schema validation before platform access", async () => {
    const server = createTailorKitServer({
      baseUrl: "https://example.com/api/tailorkit",
      cliAuth: { signInPath: "/sign-in" },
      components: {},
      scopes: { org: z.object({ orgId: z.string().min(1) }) },
    });

    await expect(
      server.handler(
        new Request(
          "https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"
        ),
        { authenticate: () => ({ scopes: { org: { orgId: "" } } }) }
      )
    ).rejects.toThrow(/failed its Standard Schema validation/u);
  });

  it("approves CLI auth from the built-in approval page", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
        platformFetch: async (request, init) => {
          const platformRequest =
            request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          return Response.json({ id: "cli_auth_session_1" });
        },
        platformHeaders: { authorization: "Bearer host-token" },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: { org: testScopeSchema },
    });
    const body = new URLSearchParams({
      intent: "approve",
      userCode: "ABC-123-XYZ",
    });
    const response = await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve", {
        body,
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }) }
    );

    const html = await response.text();
    expect(html).toContain("CLI login approved");
    expect(requests[0]?.url).toBe(
      "http://localhost:3000/api/platform/cli-auth/approve"
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer host-token");
    await expect(requests[0]?.json()).resolves.toEqual({
      scope: { name: "org", value: { orgId: "org_1" } },
      userCode: "ABC-123-XYZ",
    });
  });

  it("uses projectKey as the default platform authorization header", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
        platformFetch: async (request, init) => {
          const platformRequest =
            request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          return Response.json({ id: "cli_auth_session_1" });
        },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      projectKey: "project-key",
      scopes: { org: testScopeSchema },
    });
    const body = new URLSearchParams({
      intent: "approve",
      userCode: "ABC-123-XYZ",
    });

    await server.handler(
      new Request("https://example.com/api/tailorkit/cli-auth/approve", {
        body,
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }) }
    );

    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer project-key"
    );
  });

  it("surfaces rejected project keys during CLI auth start", async () => {
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
        platformFetch: async () =>
          new Response("Unauthorized", { status: 401 }),
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      projectKey: "invalid-project-key",
      scopes: { org: testScopeSchema },
    });
    const client = createTailorKitClient({
      fetch: async (request, init) => {
        const hostRequest =
          request instanceof Request ? request : new Request(request, init);

        return await server.handler(hostRequest, {
          authenticate: () => ({ scopes: { org: { orgId: "org_1" } } }),
        });
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.cliAuth.start({})).rejects.toThrow(
      "TailorKit platform rejected the host project key. Check TAILORKIT_PROJECT_KEY."
    );
  });

  it("calls the platform client with authorization headers", async () => {
    const requests: Request[] = [];
    const hostRequests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
        platformFetch: async (request, init) => {
          const platformRequest =
            request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          if (platformRequest.url.endsWith("/cli-auth/verify-token")) {
            return Response.json({
              scope: { name: "org", value: { orgId: "org_1" } },
            });
          }

          return Response.json({
            items: [],
            pagination: { hasMore: false, page: 1, pageSize: 20 },
          });
        },
        platformHeaders: { authorization: "Bearer host-token" },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: { org: testScopeSchema },
    });
    const client = createTailorKitClient({
      fetch: async (request, init) => {
        const hostRequest =
          request instanceof Request
            ? new Request(request, {
                headers: { authorization: "Bearer host-token" },
              })
            : new Request(request, {
                ...init,
                headers: new Headers([
                  ...new Headers(init?.headers).entries(),
                  ["authorization", "Bearer host-token"],
                ]),
              });
        hostRequests.push(hostRequest);

        return await server.handler(hostRequest, {
          authenticate: () => {
            throw new Error(
              "Host authentication should not run for deploy-token routes."
            );
          },
        });
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(client.cliAuth.verifyToken({})).resolves.toEqual({
      scope: { name: "org", value: { orgId: "org_1" } },
    });
    await expect(client.apps.list({ page: 1 })).resolves.toEqual({
      items: [],
      pagination: { hasMore: false, page: 1, pageSize: 20 },
    });
    expect(hostRequests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toBe(
      "http://localhost:3000/api/platform/cli-auth/verify-token"
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer host-token");
    expect(requests[1]?.url).toBe(
      "http://localhost:3000/api/platform/cli-auth/verify-token"
    );
    expect(requests[2]?.url).toBe(
      "http://localhost:3000/api/platform/apps/list"
    );
    expect(requests[2]?.headers.get("authorization")).toBe("Bearer host-token");
  });

  it("attaches the validated CLI deploy token scope when creating platform apps", async () => {
    const requests: Request[] = [];
    const hostRequests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformBaseUrl: "http://localhost:3000/api/platform",
        // oxlint-disable-next-line eslint/require-await -- This Promise-based test double must convert synchronous failures to rejections and preserve the asynchronous API contract.
        platformFetch: async (request, init) => {
          const platformRequest =
            request instanceof Request ? request : new Request(request, init);
          requests.push(platformRequest);

          if (platformRequest.url.endsWith("/cli-auth/verify-token")) {
            return Response.json({
              scope: { name: "org", value: { orgId: "org_1" } },
            });
          }

          return Response.json({ id: "app_1" });
        },
        platformHeaders: { authorization: "Bearer host-token" },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: { org: testScopeSchema },
    });
    const client = createTailorKitClient({
      fetch: async (request, init) => {
        const hostRequest =
          request instanceof Request
            ? new Request(request, {
                headers: { authorization: "Bearer cli-token" },
              })
            : new Request(request, {
                ...init,
                headers: new Headers([
                  ...new Headers(init?.headers).entries(),
                  ["authorization", "Bearer cli-token"],
                ]),
              });
        hostRequests.push(hostRequest);

        return await server.handler(hostRequest, {
          authenticate: () => {
            throw new Error(
              "Host authentication should not run for deploy-token routes."
            );
          },
        });
      },
      url: "https://example.com/api/tailorkit",
    });

    await expect(
      client.apps.create({
        createdByAgent: true,
        description: null,
        name: "Calendar",
      })
    ).resolves.toEqual({
      id: "app_1",
    });
    expect(hostRequests[0]?.method).toBe("POST");
    await expect(requests[1]?.json()).resolves.toEqual({
      createdByAgent: true,
      description: null,
      name: "Calendar",
      scope: { name: "org", value: { orgId: "org_1" } },
    });
  });

  it.each([true, false])(
    "returns AI provenance from app lookups: %s",
    async (createdByAgent) => {
      const server = createTailorKitServer({
        $internal: {
          platformFetch: async (input, init) => {
            const request =
              input instanceof Request ? input : new Request(input, init);
            if (request.url.endsWith("/cli-auth/verify-token")) {
              return Response.json({
                scope: { name: "org", value: { orgId: "org_1" } },
              });
            }
            expect(request.url).toBe(
              "https://tailorkit.dev/api/platform/apps/app_1/lookup"
            );
            expect(await request.json()).toEqual({
              scopes: [{ name: "org", value: { orgId: "org_1" } }],
            });
            return Response.json({ createdByAgent, id: "app_1" });
          },
        },
        baseUrl: "https://example.com/api/tailorkit",
        components: {},
        scopes: { org: testScopeSchema },
      });
      const client = createTailorKitClient({
        fetch: async (input, init) =>
          await server.handler(
            input instanceof Request ? input : new Request(input, init),
            {
              authenticate: () => {
                throw new Error(
                  "Host authentication should not run for deploy-token routes."
                );
              },
            }
          ),
        headers: { authorization: "Bearer cli-token" },
        url: "https://example.com/api/tailorkit",
      });
      await expect(client.apps.get({ appId: "app_1" })).resolves.toEqual({
        createdByAgent,
        id: "app_1",
      });
    }
  );

  it("preserves instance discovery when the CLI deploys through the host", async () => {
    const requests: Request[] = [];
    const server = createTailorKitServer({
      $internal: {
        // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
        platformFetch: async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          requests.push(request);
          if (request.url.endsWith("/cli-auth/verify-token")) {
            return Response.json({
              scope: { name: "org", value: { orgId: "org_1" } },
            });
          }
          return Response.json({
            assets: [],
            deployment: { id: "deployment" },
          });
        },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: { org: testScopeSchema },
    });
    const client = createTailorKitClient({
      fetch: async (input, init) =>
        await server.handler(
          input instanceof Request ? input : new Request(input, init),
          {
            authenticate: () => {
              throw new Error("Expected CLI authentication");
            },
          }
        ),
      headers: { authorization: "Bearer cli-token" },
      url: "https://host.test/api/tailorkit",
    });
    const views = [
      { instances: true as const, path: "/", slot: "page" },
      { path: "/", slot: "panel" },
      { disabled: true as const, path: "/disabled", slot: "page" },
    ];
    await client.deployments.create({
      appId: "app",
      assets: [
        {
          checksum: "0".repeat(64),
          contentLength: 1,
          contentType: "application/javascript",
          encoding: "utf-8",
          objectKey: "client.js",
        },
      ],
      views,
    });
    await expect(requests[1]?.json()).resolves.toMatchObject({ views });
  });

  it("accepts a CLI token containing a transformed scope output", async () => {
    const platformBodies: unknown[] = [];
    const server = createTailorKitServer({
      $internal: {
        platformFetch: async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(input, init);
          if (request.url.endsWith("/cli-auth/verify-token")) {
            return Response.json({
              scope: { name: "org", value: { canonical: "org_1" } },
            });
          }
          platformBodies.push(await request.json());
          return Response.json({ id: "app_1" });
        },
      },
      baseUrl: "https://example.com/api/tailorkit",
      components: {},
      scopes: {
        org: z
          .object({ raw: z.string() })
          .transform(({ raw }) => ({ canonical: raw.trim() })),
      },
    });
    const client = createTailorKitClient({
      fetch: async (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        request.headers.set("authorization", "Bearer cli-token");
        return await server.handler(request, { authenticate: () => null });
      },
      url: "https://example.com/api/tailorkit",
    });
    await expect(
      client.apps.create({ description: null, name: "Calendar" })
    ).resolves.toEqual({
      id: "app_1",
    });
    expect(platformBodies).toEqual([
      {
        description: null,
        name: "Calendar",
        scope: { name: "org", value: { canonical: "org_1" } },
      },
    ]);
  });
});
