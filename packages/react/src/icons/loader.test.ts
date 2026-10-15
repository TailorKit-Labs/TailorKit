import { describe, expect, it, vi } from "vite-plus/test";

import { createIconLoader } from "./loader";

const icon = { nodes: [["path", { d: "M5 12h14" }]], size: 24 };

describe("icon loader", () => {
  it("deduplicates concurrent requests and caches successful loads", async () => {
    const fetchIcon = vi.fn<typeof fetch>(
      async () => await Promise.resolve(Response.json(icon))
    );
    const loader = createIconLoader({ fetch: fetchIcon, library: "lucide" });
    expect(loader.peek("arrow-right")).toBeUndefined();
    const [first, second] = await Promise.all([
      loader.load("arrow-right"),
      loader.load("arrow-right"),
    ]);
    expect(first).toBe(second);
    expect(await loader.load("arrow-right")).toBe(first);
    expect(loader.peek("arrow-right")).toBe(first);
    expect(fetchIcon).toHaveBeenCalledTimes(1);
    const [call] = fetchIcon.mock.calls;
    expect(call?.[0]).toEqual(
      new URL("https://icons.tailorkit.app/lucide/1.55.0/arrow-right.json")
    );
    expect(call?.[1]?.credentials).toBe("omit");
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("supports a self-hosted catalogue directory", async () => {
    const fetchIcon = vi.fn<typeof fetch>(
      async () => await Promise.resolve(Response.json(icon))
    );
    const loader = createIconLoader({
      baseUrl: "https://assets.test/icons",
      fetch: fetchIcon,
      library: "lucide",
    });
    await loader.load("check");
    expect(fetchIcon.mock.calls[0]?.[0]).toEqual(
      new URL("https://assets.test/icons/lucide/1.55.0/check.json")
    );
  });

  it("retries failures on later loads", async () => {
    const fetchIcon = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(icon));
    const loader = createIconLoader({ fetch: fetchIcon, library: "lucide" });
    await expect(loader.load("check")).rejects.toThrow("Unable to load icon");
    expect(await loader.load("check")).toEqual(icon);
    expect(fetchIcon).toHaveBeenCalledTimes(2);
  });

  it.each([
    "../check",
    "check.svg",
    "https://other.test/icon",
    "x".repeat(101),
  ])("rejects invalid names without fetching: %s", async (name) => {
    const fetchIcon = vi.fn<typeof fetch>();
    const loader = createIconLoader({ fetch: fetchIcon, library: "lucide" });
    await expect(loader.load(name)).rejects.toThrow("Invalid icon name");
    expect(fetchIcon).not.toHaveBeenCalled();
  });

  it.each([
    Response.json({ nodes: [["script", {}]], size: 24 }),
    new Response("invalid JSON"),
    new Response(" ".repeat(32_769)),
  ])("rejects malformed catalogue responses", async (response) => {
    const loader = createIconLoader({
      fetch: async () => await Promise.resolve(response),
      library: "lucide",
    });
    await expect(loader.load("check")).rejects.toThrow();
  });
});
