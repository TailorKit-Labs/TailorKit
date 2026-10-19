// @vitest-environment happy-dom
import * as v from "valibot";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { sandboxMessageType } from "#bridge";
import { IframeToHostPayload } from "#protocol";

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
  const messages: IframeToHostPayload[] = [];
  const envelope = v.object({ payload: IframeToHostPayload });
  const postMessage = vi
    .spyOn(window, "postMessage")
    .mockImplementation((message: Parameters<Window["postMessage"]>[0]) => {
      const parsed = v.safeParse(envelope, message);
      if (parsed.success) {
        messages.push(parsed.output.payload);
      }
    });
  cleanups.push(() => {
    postMessage.mockRestore();
  });
  const parentWindow = window;
  const importModule = vi.fn(async () => await Promise.resolve(module));
  cleanups.push(
    startIframeRuntime({ channel: "test", importModule, parentWindow, root })
  );
  const send = (payload: MessageEvent<unknown>["data"]) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel: "test", payload, type: sandboxMessageType },
        source: parentWindow,
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
  return {
    importModule,
    messages,
    parentWindow: { postMessage },
    root,
    send,
    update,
  };
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
      render: (node, root) => {
        root.replaceChildren(...(node instanceof Node ? [node] : []));
      },
    },
    slots: {
      panel: {
        "/": {
          component: (props) => {
            const button = document.createElement("patchsmith-button");
            button.textContent = String(props.context?.name);
            button.dataset.patchsmithCallbacks = JSON.stringify({
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
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe("first");
  });
  const snapshot = runtime.messages.find(
    (message) => message.type === "snapshot"
  );
  if (snapshot?.type !== "snapshot" || snapshot.data.tree.kind === "text") {
    throw new Error("Expected a rendered snapshot");
  }
  const [button] = snapshot.data.tree.children;
  if (button?.kind !== "element") {
    throw new Error("Expected a button element");
  }
  expect(button.callbacks).toEqual([
    { callback: "onClick", event: "click", inputCount: 0 },
  ]);
  runtime.send({
    data: { args: [], event: "click", nodeId: button.id },
    type: "dispatchCallback",
  });
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe("1");
  });
  runtime.update(request("second"));
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe("second");
  });
  expect(runtime.importModule).toHaveBeenCalledTimes(1);
  runtime.update({ ...request("second"), slot: "unsupported" });
  await vi.waitFor(() => {
    expect(runtime.root.childNodes).toHaveLength(0);
  });
  const cleared = runtime.messages.findLast(
    (message) => message.type === "snapshot"
  );
  expect(
    cleared?.type === "snapshot" && cleared.data.tree.kind !== "text"
      ? cleared.data.tree.children
      : null
  ).toEqual([]);
});

it("reports a mount-only module instead of bypassing view resolution", async () => {
  const mount =
    vi.fn<NonNullable<NonNullable<Parameters<typeof setup>[0]>["mount"]>>();
  const runtime = setup({ mount });
  runtime.update({
    declaredViews: [],
    layers: [],
    slot: "panel",
    supportedViews: [],
    view: "/",
  });
  await vi.waitFor(() => {
    const error = runtime.messages.find((message) => message.type === "error");
    expect(error?.type === "error" ? error.data.message : null).toContain(
      "app builder"
    );
  });
  expect(mount).not.toHaveBeenCalled();
});

it("renders controlled requests and updates their context without reimporting the app", async () => {
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const client: AppClient = {
    $runtime: {
      h: (component, props) => component(props),
      render: (node, root) => {
        root.replaceChildren(...(node instanceof Node ? [node] : []));
      },
    },
    slots: {
      panel: {
        "/users/detail": {
          component: (props) => {
            if (props.status !== "ready") {
              return null;
            }
            return document.createTextNode(
              `${String(props.context.workspaceId)}:${String(props.context.userId)}`
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
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe("w1:u1");
  });
  runtime.update({ ...request, context: { userId: "u2", workspaceId: "w1" } });
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe("w1:u2");
  });
  runtime.update({
    ...request,
    context: undefined,
    status: "loading" as const,
  });
  await vi.waitFor(() => {
    expect(runtime.root.childNodes).toHaveLength(0);
  });
  expect(runtime.importModule).toHaveBeenCalledTimes(1);
});

it("forwards selected instances through the bridge and switches them without reimporting", async () => {
  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  const client: AppClient = {
    $runtime: {
      h: (component, props) => component(props),
      render: (node, root) => {
        root.replaceChildren(...(node instanceof Node ? [node] : []));
      },
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
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe('overview:{"count":1}');
  });
  runtime.update({
    ...request,
    instance: { data: { count: 2 }, key: "summary", metadata: {} },
  });
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe('summary:{"count":2}');
  });
  runtime.update({
    ...request,
    context: undefined,
    instance: undefined,
    status: "loading" as const,
  });
  await vi.waitFor(() => {
    expect(runtime.root.childNodes).toHaveLength(0);
  });
  runtime.update(request);
  await vi.waitFor(() => {
    expect(runtime.root.textContent).toBe('overview:{"count":1}');
  });
  expect(runtime.importModule).toHaveBeenCalledTimes(1);
});
