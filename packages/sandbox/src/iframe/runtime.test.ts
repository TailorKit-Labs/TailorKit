// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vite-plus/test";

import { sandboxMessageType } from "../bridge";
import type { AppClient, ViewRequest } from "./resolve-view";
import { startIframeRuntime } from "./runtime";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const setup = (module: { default?: unknown; mount?: () => void }) => {
  const root = document.createElement("div");
  const parentWindow = { postMessage: vi.fn() };
  const importModule = vi.fn(() => Promise.resolve(module));
  cleanups.push(
    startIframeRuntime({ channel: "test", importModule, parentWindow, root })
  );
  const send = <TPayload>(payload: TPayload) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel: "test", payload, type: sandboxMessageType },
        // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
        source: parentWindow as unknown as Window,
      })
    );
  };
  const update = (props: ViewRequest) => {
    send({
      data: {
        appSource: "client",
        appUrl: "https://apps.test/client.js",
        props,
      },
      type: "init",
    });
  };
  return { importModule, parentWindow, root, send, update };
};

const requestImplementation = (name: string): ViewRequest => ({
  declaredViews: ["/"],
  layers: [{ context: { name }, path: "/", status: "ready" }],
  slot: "panel",
  supportedViews: ["/"],
  view: "/",
});

it("imports once, publishes updates, clears unsupported slots, and dispatches callbacks", async () => {
  let clicks = 0;
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const client: AppClient = {
    $runtime: {
      h: (component, props) => component(props),
      render: (node, root) =>
        root.replaceChildren(...(node ? [node as Node] : [])),
    },
    slots: {
      panel: {
        "/": {
          component: (props) => {
            const button = document.createElement("tailorkit-button");
            button.textContent = String(props.context?.name);
            button.dataset.tailorkitCallbacks = JSON.stringify({
              click: { callback: "onClick", inputCount: 0 },
            });
            button.addEventListener("click", () => {
              button.textContent = String((clicks += 1));
            });
            return button;
          },
        },
      },
    },
  };
  const runtime = setup({ default: client });
  const request = requestImplementation;
  runtime.update(request("first"));
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("first"));
  const snapshot = runtime.parentWindow.postMessage.mock.calls.find(
    ([message]) => message.payload?.type === "snapshot"
  )?.[0].payload.data.tree;
  expect(snapshot.children[0].callbacks).toEqual([
    { callback: "onClick", event: "click", inputCount: 0 },
  ]);
  runtime.send({
    data: { args: [], event: "click", nodeId: snapshot.children[0].id },
    type: "dispatchCallback",
  });
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("1"));
  runtime.update(request("second"));
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("second"));
  expect(runtime.importModule).toHaveBeenCalledTimes(1);
  runtime.update({ ...request("second"), slot: "unsupported" });
  await vi.waitFor(() => expect(runtime.root.childNodes).toHaveLength(0));
  expect(
    runtime.parentWindow.postMessage.mock.calls.at(-1)?.[0].payload.data.tree
      .children
  ).toEqual([]);
});

it("reports a mount-only module instead of bypassing view resolution", async () => {
  const mount = vi.fn();
  const runtime = setup({ mount });
  runtime.update({
    declaredViews: [],
    layers: [],
    slot: "panel",
    supportedViews: [],
    view: "/",
  });
  await vi.waitFor(() =>
    expect(runtime.parentWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          data: { message: expect.stringContaining("app builder") },
          type: "error",
        },
      }),
      "*"
    )
  );
  expect(mount).not.toHaveBeenCalled();
});

it("renders controlled requests and updates their context without reimporting the app", async () => {
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const client: AppClient = {
    $runtime: {
      h: (component, props) => component(props),
      render: (node, root) =>
        root.replaceChildren(...(node ? [node as Node] : [])),
    },
    slots: {
      panel: {
        "/users/detail": {
          component: (props) => {
            if (props.status !== "ready") {
              return null;
            }
            return document.createTextNode(
              `${props.context.workspaceId}:${props.context.userId}`
            );
          },
        },
      },
    },
  };
  const runtime = setup({ default: client });
  const request = {
    context: { userId: "u1", workspaceId: "w1" },
    controlled: true as const,
    declaredViews: ["/", "/users", "/users/detail"],
    slot: "panel",
    status: "ready" as const,
    supportedViews: ["/users/detail"],
    view: "/users/detail",
  };
  runtime.update(request);
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("w1:u1"));
  runtime.update({ ...request, context: { userId: "u2", workspaceId: "w1" } });
  await vi.waitFor(() => expect(runtime.root.textContent).toBe("w1:u2"));
  runtime.update({
    ...request,
    context: undefined,
    status: "loading" as const,
  });
  await vi.waitFor(() => expect(runtime.root.childNodes).toHaveLength(0));
  expect(runtime.importModule).toHaveBeenCalledTimes(1);
});

it("forwards selected instances through the bridge and switches them without reimporting", async () => {
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const client: AppClient = {
    $runtime: {
      h: (component, props) => component(props),
      render: (node, root) =>
        root.replaceChildren(...(node ? [node as Node] : [])),
    },
    slots: {
      panel: {
        "/": {
          component: (props) =>
            props.status === "ready"
              ? document.createTextNode(
                  `${props.instance?.key}:${JSON.stringify(props.instance?.data)}`
                )
              : null,
          instances: { resolver: "compiled" },
        },
      },
    },
  };
  const runtime = setup({ default: client });
  const request = {
    context: {},
    controlled: true as const,
    declaredViews: ["/"],
    instance: { data: { count: 1 }, key: "overview", metadata: {} },
    slot: "panel",
    status: "ready" as const,
    supportedViews: ["/"],
    view: "/",
  };
  runtime.update(request);
  await vi.waitFor(() =>
    expect(runtime.root.textContent).toBe('overview:{"count":1}')
  );
  runtime.update({
    ...request,
    instance: { data: { count: 2 }, key: "summary", metadata: {} },
  });
  await vi.waitFor(() =>
    expect(runtime.root.textContent).toBe('summary:{"count":2}')
  );
  // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.
  runtime.update({
    ...request,
    context: undefined,
    status: "loading",
  } as unknown as ViewRequest);
  await vi.waitFor(() => expect(runtime.root.childNodes).toHaveLength(0));
  runtime.update(request);
  await vi.waitFor(() =>
    expect(runtime.root.textContent).toBe('overview:{"count":1}')
  );
  expect(runtime.importModule).toHaveBeenCalledTimes(1);
});
