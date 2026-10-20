// @vitest-environment happy-dom
import { createRemoteViewStore } from "@patchsmith/client-core";
import type { experimental_CanvasPolicy } from "@patchsmith/core/schema";
import { experimental_canvas } from "@patchsmith/core/schema";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { experimental_canvasRenderer } from "#canvas";
import { CanvasNodeContext } from "#canvas-context";

afterEach(cleanup);

const createContextValue = (
  store: ReturnType<typeof createRemoteViewStore>,
  policy: experimental_CanvasPolicy
) => ({ nodeId: "node", policy, store });

it("registers a surface once, rebinds when dimensions change, and revokes on unmount", () => {
  const store = createRemoteViewStore();
  const revoke = vi.fn<() => void>();

  const register = vi
    .spyOn(store, "experimental_registerCanvas")
    .mockReturnValue(revoke);

  const policy = experimental_canvas({
    maxFramesPerSecond: 30,
    maxPixels: 100_000,
  }).experimental_canvas;

  const context = createContextValue(store, policy);

  const props = {
    ariaLabel: "Chart",
    height: 100,
    surface: "surface",
    width: 320,
  };

  const output = render(
    <CanvasNodeContext.Provider value={context}>
      {experimental_canvasRenderer({ props })}
    </CanvasNodeContext.Provider>
  );

  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenLastCalledWith(
    "node",
    "surface",
    output.getByRole("img", { name: "Chart" }),
    policy
  );
  output.rerender(
    <CanvasNodeContext.Provider value={context}>
      {experimental_canvasRenderer({ props: { ...props } })}
    </CanvasNodeContext.Provider>
  );
  expect(register).toHaveBeenCalledTimes(1);
  output.rerender(
    <CanvasNodeContext.Provider value={context}>
      {experimental_canvasRenderer({ props: { ...props, width: 640 } })}
    </CanvasNodeContext.Provider>
  );
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledTimes(2);
  output.unmount();
  expect(revoke).toHaveBeenCalledTimes(2);
});

it("rejects ungranted renderers and props that exceed host policy", () => {
  const props = {
    ariaLabel: "Chart",
    height: 200,
    surface: "surface",
    width: 320,
  };

  expect(() => render(experimental_canvasRenderer({ props }))).toThrow(
    "host contract"
  );

  const context = createContextValue(createRemoteViewStore(), {
    maxPixels: 100,
  });

  expect(() =>
    render(
      <CanvasNodeContext.Provider value={context}>
        {experimental_canvasRenderer({ props })}
      </CanvasNodeContext.Provider>
    )
  ).toThrow("pixel limit");
});
