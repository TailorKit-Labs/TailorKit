import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { Icon } from "#icons/icon";

afterEach(cleanup);

const arrow = { nodes: [["path", { d: "M5 12h14" }]], size: 24 };

describe("icon renderer", () => {
  it("reserves dimensions while loading and renders decorative inline SVG", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetchIcon = vi.fn<typeof fetch>(async () => await pending.promise);
    const Renderer = Icon({ fetch: fetchIcon, library: "lucide" });

    const view = render(
      <Renderer
        props={{
          name: "arrow-right",
          size: 16,
        }}
      />
    );

    const svg = view.container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    expect(svg?.querySelector("path")).toBeNull();
    await act(async () => {
      pending.resolve(Response.json(arrow));
      await pending.promise;
    });
    await waitFor(() => {
      expect(svg?.querySelector("path")?.getAttribute("d")).toBe("M5 12h14");
    });
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-width")).toBe("2");
  });

  it("hides decorative icons and shares cached geometry across mounts", async () => {
    const fetchIcon = vi.fn<typeof fetch>(
      async () => await Promise.resolve(Response.json(arrow))
    );

    const Renderer = Icon({ fetch: fetchIcon, library: "lucide" });
    const first = render(<Renderer props={{ name: "arrow-right" }} />);
    await waitFor(() => {
      expect(first.container.querySelector("path")).not.toBeNull();
    });
    first.unmount();
    const second = render(<Renderer props={{ name: "arrow-right" }} />);
    expect(second.container.querySelector("path")).not.toBeNull();
    expect(
      second.container.querySelector("svg")?.getAttribute("aria-hidden")
    ).toBe("true");
    expect(fetchIcon).toHaveBeenCalledTimes(1);
  });

  it("ignores stale responses when the icon name changes", async () => {
    const pending = Promise.withResolvers<Response>();

    const fetchIcon = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => await pending.promise)
      .mockResolvedValueOnce(
        Response.json({ nodes: [["circle", { r: 2 }]], size: 24 })
      );

    const Renderer = Icon({ fetch: fetchIcon, library: "lucide" });
    const view = render(<Renderer props={{ name: "arrow-right" }} />);
    view.rerender(<Renderer props={{ name: "circle" }} />);
    await waitFor(() => {
      expect(view.container.querySelector("circle")).not.toBeNull();
    });
    await act(async () => {
      pending.resolve(Response.json(arrow));
      await pending.promise;
    });
    expect(view.container.querySelector("path")).toBeNull();
    expect(view.container.querySelector("circle")).not.toBeNull();
  });

  it("keeps a failed icon empty without breaking its siblings", async () => {
    const Renderer = Icon({
      fetch: async () =>
        await Promise.resolve(new Response(null, { status: 404 })),
      library: "lucide",
    });

    const view = render(
      <>
        <Renderer props={{ name: "camera" }} />
        <span>Still visible</span>
      </>
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Still visible")).toBeDefined();
    expect(view.container.querySelector("svg")?.getAttribute("width")).toBe(
      "24"
    );
    expect(view.container.querySelector("path")).toBeNull();
  });
});
