/* oxlint-disable require-await -- the platform fetch mock has the Fetch promise shape. */
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createTailorKitServer } from "./handler";
import { isActivePreviewConflict } from "./routes/preview";

const shareId = "s".repeat(43);
const testScopeSchema = z.record(z.string(), z.string().min(1));
const grantId = "g".repeat(43);
const basePath = "/custom/tailorkit";
const baseUrl = `https://host.test${basePath}`;

const server = (
  requests: string[],
  previewError?: unknown,
  platformBodies: unknown[] = []
) =>
  createTailorKitServer({
    $internal: {
      platformFetch: async (input, init) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}${url.search}`);
        let body: Record<string, unknown> | undefined;
        if (
          request.method !== "GET" &&
          request.headers.get("content-type")?.includes("json")
        ) {
          body = (await request.clone().json()) as Record<string, unknown>;
          platformBodies.push(body);
        }
        if (url.pathname.endsWith(`/preview/shares/${shareId}/accept`)) {
          if (previewError) {
            return Response.json(previewError, { status: 503 });
          }
          return Response.json({ grantId, sessionId: "session" });
        }
        if (url.pathname.endsWith(`/preview/shares/${shareId}`)) {
          if (previewError) {
            return Response.json(previewError, { status: 503 });
          }
          return Response.json({
            appName: "Example app",
            expiresAt: new Date().toISOString(),
            sessionId: "session",
          });
        }
        if (url.pathname.endsWith("/apps/list")) {
          const page = Number(body?.page);
          return Response.json(
            page === 1
              ? {
                  items: [
                    {
                      clientPath: "https://assets.test/first.js",
                      id: "first",
                      name: "Published",
                    },
                  ],
                  pagination: { hasMore: true, page: 1, pageSize: 100 },
                }
              : {
                  items: [{ id: "second", name: "Published 2" }],
                  pagination: { hasMore: false, page: 2, pageSize: 100 },
                }
          );
        }
        if (url.pathname.endsWith("/preview/grants/resolve")) {
          return Response.json({
            items: [
              {
                app: { id: "first", name: "Preview copy" },
                preview: {
                  expiresAt: "later",
                  sessionId: "session-1",
                  token: "t1",
                  websocketUrl: "wss://platform.test/ws",
                },
              },
              {
                app: { id: "other", name: "Cross scope" },
                preview: {
                  expiresAt: "later",
                  sessionId: "session-2",
                  token: "t2",
                  websocketUrl: "wss://platform.test/ws",
                },
              },
            ],
          });
        }
        return new Response("Not found", { status: 404 });
      },
    },
    baseUrl,
    cliAuth: { signInPath: "/sign-in" },
    components: {},
    preview: { returnPath: "/dashboard" },
    projectKey: "server-key",
    scopes: { org: testScopeSchema },
  });

describe("preview host flow", () => {
  it("identifies active preview conflicts by reason and supports legacy platform messages", () => {
    expect(
      isActivePreviewConflict({
        code: "CONFLICT",
        data: { reason: "ACTIVE_PREVIEW_EXISTS" },
        message: "The wording can change without affecting the CLI.",
      })
    ).toBe(true);
    expect(
      isActivePreviewConflict({
        code: "CONFLICT",
        message: "A preview is already running.",
      })
    ).toBe(true);
    expect(
      isActivePreviewConflict({
        code: "CONFLICT",
        message: "An active preview already exists.",
      })
    ).toBe(true);
    expect(
      isActivePreviewConflict({
        code: "CONFLICT",
        message: "This scope already has 5 active previews.",
      })
    ).toBe(false);
  });

  it("routes preview start POSTs through the RPC handler", async () => {
    const requests: string[] = [];
    const tailor = server(requests);
    const response = await tailor.handler(
      new Request(`${baseUrl}/preview/start`, {
        body: JSON.stringify({ json: { appId: "app" } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }) }
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("Preview Example app");
  });

  it("returns 503 for structured platform storage errors", async () => {
    const tailor = server([], {
      code: "SERVICE_UNAVAILABLE",
      message: "KV unavailable",
    });
    const consentUrl = `${baseUrl}/preview/${shareId}`;
    const options = {
      authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }),
    };
    const invitation = await tailor.handler(new Request(consentUrl), options);
    expect(invitation.status).toBe(503);

    const acceptance = await tailor.handler(
      new Request(consentUrl, {
        body: "intent=accept",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://host.test",
        },
        method: "POST",
      }),
      options
    );
    expect(acceptance.status).toBe(503);
  });

  it("uses the custom mount, requires login, and rejects cross-origin acceptance", async () => {
    const requests: string[] = [];
    const platformBodies: unknown[] = [];
    const tailor = server(requests, undefined, platformBodies);
    const consentUrl = `${baseUrl}/preview/${shareId}`;
    const guest = await tailor.handler(new Request(consentUrl), {
      authenticate: () => null,
    });
    expect(guest.status).toBe(302);
    expect(guest.headers.get("location")).toContain("/sign-in?returnTo=");

    const consent = await tailor.handler(new Request(consentUrl), {
      authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }),
    });
    const consentHtml = await consent.text();
    expect(consentHtml).toContain(
      "After you accept, this preview is available only in this browser."
    );
    expect(consentHtml).toContain("Accept preview");
    expect(consentHtml).toContain('class="warning" role="note"');
    expect(consentHtml).toContain("Untrusted content");
    expect(consentHtml).toContain(
      "Only accept previews from trusted developers."
    );
    expect(consent.headers.get("referrer-policy")).toBe("strict-origin");
    expect(consent.headers.get("set-cookie")).toBeNull();
    expect(consent.headers.get("cache-control")).toBe("no-store");

    const foreign = await tailor.handler(
      new Request(consentUrl, {
        body: "intent=accept",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.test",
        },
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }) }
    );
    expect(foreign.status).toBe(403);
    expect(requests.some((value) => value.endsWith("/accept"))).toBe(false);

    const opaqueOriginWithoutToken = await tailor.handler(
      new Request(consentUrl, {
        body: "intent=accept",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "null",
        },
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }) }
    );
    expect(opaqueOriginWithoutToken.status).toBe(403);

    const accepted = await tailor.handler(
      new Request(consentUrl, {
        body: "intent=accept",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://host.test",
        },
        method: "POST",
      }),
      { authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }) }
    );
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("location")).toBe("/dashboard");
    expect(accepted.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Lax; Secure"
    );
    expect(accepted.headers.get("set-cookie")).toContain(`Path=${basePath}`);
    expect(platformBodies).toContainEqual({
      scope: { name: "org", value: { tenant: "viewer" } },
    });
    const cancelled = await tailor.handler(
      new Request(consentUrl, {
        body: "intent=cancel",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://host.test",
        },
        method: "POST",
      }),
      { authenticate: () => null }
    );
    expect(cancelled.status).toBe(303);
    expect(cancelled.headers.get("location")).toBe("/dashboard");
  });

  it.each([
    { origin: "null", site: "same-site" },
    { origin: "null", site: "cross-site" },
    { origin: "https://sibling.host.test", site: "same-site" },
    { origin: "https://host.test", site: "cross-site" },
    { origin: undefined, site: "same-origin" },
  ])(
    "rejects injected consent tokens with origin=$origin and site=$site",
    async ({ origin, site }) => {
      const requests: string[] = [];
      const tailor = server(requests);
      const token = "a".repeat(64);
      const headers = new Headers({
        "content-type": "application/x-www-form-urlencoded",
        cookie: `tailorkit_preview_csrf=${token}`,
        "sec-fetch-site": site,
      });
      if (origin !== undefined) {
        headers.set("origin", origin);
      }
      const response = await tailor.handler(
        new Request(`${baseUrl}/preview/${shareId}`, {
          body: `intent=accept&csrfToken=${token}`,
          headers,
          method: "POST",
        }),
        { authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }) }
      );
      expect(response.status).toBe(403);
      expect(requests).toEqual([]);
    }
  );

  it.each(["https://host.test", "http://localhost:3000"])(
    "keeps multiple consent pages usable at %s without a shared expiring token",
    async (origin) => {
      const requests: string[] = [];
      const tailor = server(requests);
      const consentUrl = `${origin}${basePath}/preview/${shareId}`;
      const options = {
        authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }),
      };
      const first = await tailor.handler(new Request(consentUrl), options);
      const second = await tailor.handler(new Request(consentUrl), options);
      for (const page of [first, second]) {
        expect(page.status).toBe(200);
        expect(page.headers.get("referrer-policy")).toBe("strict-origin");
        expect(page.headers.get("set-cookie")).toBeNull();
        // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
        expect(await page.text()).not.toContain('name="csrfToken"');
        // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
        const accepted = await tailor.handler(
          new Request(consentUrl, {
            body: "intent=accept",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              origin,
              "sec-fetch-site": "same-origin",
            },
            method: "POST",
          }),
          options
        );
        expect(accepted.status).toBe(303);
      }
      expect(
        requests.filter((value) => value.endsWith("/accept"))
      ).toHaveLength(2);
    }
  );

  it("rejects a return path that could leave the host origin", () => {
    expect(() =>
      createTailorKitServer({
        baseUrl: "https://example.com/api/tailorkit",
        components: {},
        preview: { returnPath: "//evil.test" },
        scopes: { org: testScopeSchema },
      })
    ).toThrow("same-origin root-relative");
  });

  it("keeps every published app field across pages and appends accepted cross-scope apps", async () => {
    const requests: string[] = [];
    const platformBodies: unknown[] = [];
    const tailor = server(requests, undefined, platformBodies);
    const cookie = `tailorkit_preview_grants=${encodeURIComponent(JSON.stringify([grantId]))}`;
    const response = await tailor.handler(
      new Request(`${baseUrl}/apps`, { headers: { cookie } }),
      {
        authenticate: () => ({ scopes: { org: { tenant: "viewer" } } }),
      }
    );
    expect(response.status).toBe(200);
    const apps = (await response.json()) as {
      id: string;
      name: string;
      clientPath?: string;
      preview?: { sessionId: string };
    }[];
    expect(apps).toHaveLength(3);
    expect(apps[0]).toMatchObject({
      clientPath: "https://assets.test/first.js",
      id: "first",
      name: "Published",
      preview: { sessionId: "session-1" },
    });
    expect(apps[1]).toMatchObject({ id: "second", name: "Published 2" });
    expect(apps[2]).toMatchObject({
      id: "other",
      name: "Cross scope",
      preview: { sessionId: "session-2" },
    });
    const appListRequests = requests.filter((value) =>
      value.includes("/apps/list")
    );
    expect(appListRequests).toHaveLength(2);
    expect(platformBodies).toContainEqual({
      page: 1,
      pageSize: 100,
      scopes: [{ name: "org", value: { tenant: "viewer" } }],
    });
    expect(platformBodies).toContainEqual({
      grantIds: [grantId],
      scopes: [{ name: "org", value: { tenant: "viewer" } }],
    });
  });
});
