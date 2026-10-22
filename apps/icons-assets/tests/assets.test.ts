import { lucideVersion, parseIconData } from "@patchsmith/core/icons";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [
    { configPath: new URL("../wrangler.jsonc", import.meta.url) },
    {
      config: {
        compatibility_date: "2026-10-01",
        main: new URL("fixtures/app-runtime.ts", import.meta.url).pathname,
        name: "app-runtime-route-fixture",
        routes: [{ pattern: "*.tailorkit.app/*", zone_name: "tailorkit.app" }],
      },
    },
  ],
});

const origin = "https://icons.tailorkit.app";
const catalogue = `/lucide/${lucideVersion}`;

beforeAll(async () => {
  await server.listen();
}, 30_000);

afterAll(async () => {
  await server.close();
}, 30_000);

describe("icon static assets", () => {
  it("serves validated geometry directly with immutable caching and CORS", async () => {
    // The fallback returns 404 for every GET: 200 proves static delivery bypasses it.
    const response = await server.fetch(`${catalogue}/arrow-right.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(parseIconData(await response.json()).nodes.length).toBeGreaterThan(
      0
    );
  });

  it("routes the catalogue ahead of the app runtime wildcard", async () => {
    const response = await server.fetch("https://team.tailorkit.app/rpc");
    expect(response.status).toBe(418);
    expect(await response.text()).toBe("app runtime");
    // Absolute routes in the local proxy dispatch to the script directly.
    // An unmatched path still proves the exact icon route beats the wildcard.
    const icon = await server.fetch(`${origin}/missing`);
    expect(icon.status).toBe(404);
    expect(icon.headers.get("Cache-Control")).toBe("no-store");
  });

  it("supports HEAD without returning the icon body", async () => {
    const response = await server.fetch(`${catalogue}/check.json`, {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(await response.text()).toBe("");
  });

  it("publishes aliases and upstream license notices", async () => {
    const alias = await server.fetch(`${catalogue}/arrow-right-circle.json`);
    expect(alias.status).toBe(200);
    const response = await server.fetch(`${catalogue}/LICENSE.txt`);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("ISC License");
    expect(text).toContain("MIT License");
  });

  it.each([
    "/lucide/1.59.0/missing.json",
    "/lucide/0.0.0/check.json",
    "/unknown",
  ])("keeps misses out of the immutable cache: %s", async (pathname) => {
    const response = await server.fetch(pathname);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("rejects unsupported methods", async () => {
    const preflight = await server.fetch(`${catalogue}/check.json`, {
      method: "OPTIONS",
    });

    expect(preflight.status).toBe(405);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const write = await server.fetch(`${catalogue}/check.json`, {
      method: "POST",
    });

    expect(write.status).toBe(405);
  });
});
