import * as v from "valibot";

import { iframeReadyType, sandboxMessageType } from "../bridge";
import { readElementProps } from "../host/serialize";
import { HostToIframePayload, RemotePropsSchema } from "../protocol";
import type {
  IframeToHostPayload,
  RemoteCallbackBinding,
  RemoteNode,
} from "../protocol";
import { createIframeBackend } from "./backend";
import { assertAppClient, renderClient } from "./resolve-view";
import type { AppClient, ViewRequest } from "./resolve-view";
import { createIframeTools } from "./tools";

type InitData = Extract<HostToIframePayload, { type: "init" }>["data"];

const readCallbacksImplementation = (
  element: Element
): RemoteCallbackBinding[] => {
  // oxlint-disable-next-line unicorn/prefer-dom-node-dataset -- SVG Element does not expose dataset in this public DOM type.
  const value = element.getAttribute("data-tailorkit-callbacks");
  if (!value) {
    return [];
  }
  try {
    const parsed = v.safeParse(RemotePropsSchema, JSON.parse(value));
    if (!parsed.success) {
      return [];
    }
    const callbackSchema = v.object({
      callback: v.string(),
      inputCount: v.number(),
    });
    return Object.entries(parsed.output).flatMap(([event, config]) => {
      const callback = v.safeParse(callbackSchema, config);
      return callback.success ? [{ ...callback.output, event }] : [];
    });
  } catch {
    return [];
  }
};

export const startIframeRuntime = (options: {
  root: HTMLElement;
  channel: string;
  parentWindow?: Pick<Window, "postMessage">;
  importModule?: (url: string) => Promise<{ default?: unknown }>;
}): (() => void) => {
  const {
    root,
    channel,
    parentWindow = window.parent,
    // oxlint-disable-next-line no-inline-comments -- Vite requires the inline import annotation for a sandbox-selected module URL.
    importModule = (url) => import(/* @vite-ignore */ url),
  } = options;
  const nodeIds = new WeakMap<Node, string>();
  const nodes = new Map<string, WeakRef<Node>>();
  let nextNodeId = 1;
  let revision = 0;
  let loadedAppUrl: string | null = null;
  let client: AppClient | null = null;
  let rendering = false;
  let destroyed = false;

  const send = (payload: IframeToHostPayload) => {
    if (!destroyed) {
      parentWindow.postMessage(
        { channel, payload, type: sandboxMessageType },
        "*"
      );
    }
  };
  const tools = createIframeTools((data) =>
    send({ data, type: "toolRequest" })
  );
  const backend = createIframeBackend((data) =>
    send({ data, type: "backendSessionRequest" })
  );
  const backendGlobal = globalThis;
  backendGlobal.__tailorkitTools = tools.bridge;
  backendGlobal.__tailorkitBackendSession = backend.getSession;
  const sendError = (cause: unknown) =>
    send({
      data: {
        message:
          cause instanceof Error ? cause.stack || cause.message : String(cause),
      },
      type: "error",
    });
  const getNodeId = (node: Node): string => {
    let id = nodeIds.get(node);
    if (!id) {
      id = `n:${(nextNodeId += 1) - 1}`;
      nodeIds.set(node, id);
      nodes.set(id, new WeakRef(node));
    }
    return id;
  };
  const readCallbacks = readCallbacksImplementation;
  const serializeNode = (node: Node): RemoteNode => {
    if (node instanceof Text) {
      return { id: getNodeId(node), kind: "text", text: node.data };
    }
    if (node instanceof Element) {
      return {
        callbacks: readCallbacks(node),
        children: Array.from(node.childNodes, serializeNode),
        id: getNodeId(node),
        kind: "element",
        props: readElementProps(node),
        type: node.localName,
      };
    }
    return {
      children: Array.from(node.childNodes, serializeNode),
      id: getNodeId(node),
      kind: "fragment",
    };
  };
  const sendSnapshot = () =>
    send({
      data: {
        revision: (revision += 1),
        tree: {
          children: Array.from(root.childNodes, serializeNode),
          id: getNodeId(root),
          kind: "fragment",
        },
      },
      type: "snapshot",
    });
  const observer = new MutationObserver(() => {
    if (!rendering) {
      sendSnapshot();
    }
  });
  observer.observe(root, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  const loadApp = async ({ appSource, appUrl, props }: InitData) => {
    if (destroyed) {
      return;
    }
    if (loadedAppUrl !== appUrl) {
      const module = await importModule(
        `data:text/javascript;charset=utf-8,${encodeURIComponent(appSource)}`
      );
      if (destroyed) {
        return;
      }
      assertAppClient(module.default);
      client = module.default;
      loadedAppUrl = appUrl;
    }
    if (!client || !props) {
      throw new Error("TailorKit app requires a view request.");
    }
    rendering = true;
    try {
      // SAFETY: The adapter reconstructs the same runtime contract, but TypeScript cannot relate the erased generic parameters across this library boundary.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The adapter reconstructs the same runtime contract, but TypeScript cannot relate the erased generic parameters across this library boundary.
      renderClient(client, props as unknown as ViewRequest, root);
    } finally {
      observer.takeRecords();
      rendering = false;
    }
    sendSnapshot();
  };
  let pendingLoad = Promise.resolve();
  const handleMessage = (event: MessageEvent) => {
    if (
      event.source !== parentWindow ||
      event.data?.channel !== channel ||
      event.data.type !== sandboxMessageType
    ) {
      return;
    }
    const parsed = v.safeParse(HostToIframePayload, event.data.payload);
    if (!parsed.success) {
      return;
    }
    const payload = parsed.output;
    if (payload?.type === "toolResult") {
      tools.receive(payload.data);
      return;
    }
    if (payload?.type === "backendSessionResult") {
      backend.receive(payload.data);
    } else if (payload?.type === "init") {
      pendingLoad = (async () => {
        try {
          await pendingLoad;
          await loadApp(payload.data);
        } catch (error) {
          sendError(error);
        }
      })();
    } else if (payload?.type === "dispatchCallback") {
      const target = nodes.get(payload.data.nodeId)?.deref();
      if (!(target instanceof Element)) {
        nodes.delete(payload.data.nodeId);
        sendError(
          new Error(
            `Cannot dispatch callback to unknown node "${payload.data.nodeId}".`
          )
        );
        return;
      }
      target.dispatchEvent(
        new CustomEvent(payload.data.event, {
          bubbles: false,
          cancelable: true,
          detail: payload.data.args ?? [],
        })
      );
    }
  };
  window.addEventListener("message", handleMessage);
  parentWindow.postMessage({ channel, type: iframeReadyType }, "*");
  send({ type: "ready" });
  return () => {
    tools.close();
    if (backendGlobal.__tailorkitTools === tools.bridge) {
      delete backendGlobal.__tailorkitTools;
    }
    backend.close();
    if (backendGlobal.__tailorkitBackendSession === backend.getSession) {
      delete backendGlobal.__tailorkitBackendSession;
    }
    destroyed = true;
    observer.disconnect();
    window.removeEventListener("message", handleMessage);
    nodes.clear();
  };
};
