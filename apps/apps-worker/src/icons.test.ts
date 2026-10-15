import { describe, expect, it, vi } from "vite-plus/test";

import { serveIcon } from "./icons";

const createEnv = () => {
  const fetchAsset = vi
    .fn<Fetcher["fetch"]>()
    .mockResolvedValue(Response.json({ nodes: [], size: 24 }));
  const env = {
    ASSET_DOMAIN: "tailorkit.app",
    ICON_ASSETS: { fetch: fetchAsset },
  };
  return { env, fetchAsset };
};

describe("icon catalogue delivery", () => {
  it("serves immutable assets with public CORS", async () => {
    const { env, fetchAsset } = createEnv();
    const response = await serveIcon(
      new Request("https://icons.tailorkit.app/lucide/1.55.0/check.json"),
      env
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toContain("immutable");
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response?.headers.get("Content-Type")).toBe(
      "application/json; charset=utf-8"
    );
    expect(fetchAsset).toHaveBeenCalledOnce();
  });

  it("leaves other worker origins to their existing routes", async () => {
    const { env, fetchAsset } = createEnv();
    expect(
      await serveIcon(
        new Request("https://internal.tailorkit.app/lucide/1.55.0/check.json"),
        env
      )
    ).toBeUndefined();
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it.each([
    "/lucide/0.0.0/check.json",
    "/other/1.55.0/check.json",
    "/lucide/1.55.0/check.json?x=1",
    "/index.html",
  ])("rejects unknown catalogue paths: %s", async (pathname) => {
    const { env, fetchAsset } = createEnv();
    const response = await serveIcon(
      new Request(`https://icons.tailorkit.app${pathname}`),
      env
    );
    expect(response?.status).toBe(404);
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("handles preflight and HEAD and rejects writes", async () => {
    const { env, fetchAsset } = createEnv();
    const url = "https://icons.tailorkit.app/lucide/1.55.0/check.json";
    const options = await serveIcon(
      new Request(url, { method: "OPTIONS" }),
      env
    );
    const post = await serveIcon(new Request(url, { method: "POST" }), env);
    expect(options?.status).toBe(204);
    expect(post?.status).toBe(405);
    expect(fetchAsset).not.toHaveBeenCalled();
    const head = await serveIcon(new Request(url, { method: "HEAD" }), env);
    expect(head?.status).toBe(200);
    expect(await head?.text()).toBe("");
  });

  it("does not cache missing icons as successful assets", async () => {
    const { env, fetchAsset } = createEnv();
    fetchAsset.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const response = await serveIcon(
      new Request("https://icons.tailorkit.app/lucide/1.55.0/missing.json"),
      env
    );
    expect(response?.status).toBe(404);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });
});
