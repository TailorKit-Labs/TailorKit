import type { ToolBridge } from "@tailorkit/app/client";
import { AppError } from "@tailorkit/app/client/connection";
import type { Session } from "@tailorkit/app/client/connection";
import * as v from "valibot";
import iframeSource from "virtual:tailorkit-iframe";

import { iframeReadyType, sandboxMessageType } from "#bridge";
import type {
  CallbackResult,
  RemoteProps,
  HostToIframePayload as HostToIframePayloadType,
} from "#protocol";
import { HostToIframePayload, IframeToHostPayload } from "#protocol";

import { createCanvasTarget } from "./canvas";
import type { experimental_CanvasTargetOptions } from "./canvas";
import { createRemoteUiStore } from "./store.js";
import type { RemoteUiStore } from "./store.js";

export { type RemoteUiStore } from "./store.js";
export { createRemoteUiStore } from "./store.js";
export type { experimental_CanvasTargetOptions } from "./canvas";

interface IframeBridgeMessage {
  channel: string;
  payload?: unknown;
  type: string;
}

export interface IframeUiHost extends RemoteUiStore {
  /** Opt in a named pixel surface for this sandbox; cleanup revokes and clears it. */
  experimental_registerCanvas: (
    name: string,
    canvas: HTMLCanvasElement,
    options?: experimental_CanvasTargetOptions
  ) => () => void;
  destroy: () => void;
  dispatch: (
    payload: HostToIframePayloadType
  ) => Promise<CallbackResult["output"]>;
  iframe: HTMLIFrameElement;
  mount: () => void;
  setProps: (props: RemoteProps | undefined) => void;
}

export interface IframeUiHostOptions {
  createIframe?: () => HTMLIFrameElement;
  fetch?: typeof globalThis.fetch;
  mountTarget?: HTMLElement;
  onError?: (error: Error) => void;
  props?: RemoteProps;
  /** Bound by the host SDK to this app installation; never supplied by the iframe. */
  toolBridge?: ToolBridge;
  getBackendSession?: (options: { refresh: boolean }) => Promise<Session>;
}

const createChannelId = (): string => {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

const toUrl = (value: string | URL): URL =>
  value instanceof URL ? value : new URL(value, globalThis.location?.href);

const createIframeDocument = (channel: string): string =>
  `<!doctype html>
<html data-tailorkit-channel="${channel}">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; worker-src 'none'; connect-src http: https: ws: wss:; img-src 'none'; style-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'">
  </head>
  <body>
    <div id="tailorkit-root"></div>
    <script>${iframeSource.replaceAll("</script", "<\\/script")}</script>
  </body>
</html>`;

const configureIframe = (iframe: HTMLIFrameElement, channel: string): void => {
  iframe.hidden = true;
  iframe.tabIndex = -1;
  iframe.title = "TailorKit extension sandbox";
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.srcdoc = createIframeDocument(channel);
};

const isBridgeMessage = (
  value: unknown,
  channel: string
): value is IframeBridgeMessage =>
  typeof value === "object" &&
  value !== null &&
  "channel" in value &&
  value.channel === channel &&
  "type" in value &&
  typeof value.type === "string";

const fetchSource = async (
  fetchImplementation: typeof globalThis.fetch,
  url: URL
): Promise<string> => {
  const response = await fetchImplementation(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(
      `Unable to load TailorKit app client from ${url.toString()}.`
    );
  }
  return await response.text();
};

export const createIframeUiHost = (
  appUrl: string | URL,
  options: IframeUiHostOptions = {}
): IframeUiHost => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    throw new TypeError(
      "TailorKit's iframe sandbox requires a browser environment."
    );
  }

  const store = createRemoteUiStore();
  const iframe = options.createIframe?.() ?? document.createElement("iframe");
  const channel = createChannelId();
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const resolvedAppUrl = toUrl(appUrl);
  const sessionCalls = new Set<string>();
  const toolCalls = new Set<string>();
  const canvases = new Map<
    string,
    { target: ReturnType<typeof createCanvasTarget>; generation: string }
  >();
  const canvasElements = new Set<HTMLCanvasElement>();
  const queuedPayloads: HostToIframePayloadType[] = [];
  const callbackCalls = new Map<
    string,
    {
      resolve: (output: CallbackResult["output"]) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const rejectCallbacks = (error: Error) => {
    for (const call of callbackCalls.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    callbackCalls.clear();
    queuedPayloads.length = 0;
  };
  let appSourcePromise: Promise<string> | null = null;
  let destroyed = false;
  let iframeReady = false;
  let mounted = false;
  let currentProps = options.props;
  let initRevision = 0;

  configureIframe(iframe, channel);

  const reportError = (cause: unknown): void => {
    rejectCallbacks(cause instanceof Error ? cause : new Error(String(cause)));
    options.onError?.(
      cause instanceof Error ? cause : new Error(String(cause))
    );
  };

  const postToIframe = (
    payload: HostToIframePayloadType,
    transfer?: Transferable[]
  ): void => {
    if (transfer) {
      iframe.contentWindow?.postMessage(
        { channel, payload, type: sandboxMessageType },
        "*",
        transfer
      );
      return;
    }
    iframe.contentWindow?.postMessage(
      { channel, payload, type: sandboxMessageType },
      "*"
    );
  };

  const connectCanvas = ({
    id,
    name,
    generation,
    input,
  }: {
    id: string;
    name: string;
    generation?: string;
    input?: boolean;
  }) => {
    const registration = canvases.get(name);
    const target = registration?.target;
    try {
      if (
        !target ||
        destroyed ||
        (generation !== undefined && generation !== registration?.generation)
      ) {
        throw new Error("Canvas surface is not registered by the host.");
      }
      const connection = target.connect(input);
      try {
        postToIframe({ data: { id, ...connection }, type: "canvasResult" }, [
          connection.port,
        ]);
      } catch (error) {
        connection.port.close();
        target.close();
        throw error;
      }
    } catch (error) {
      postToIframe({
        data: {
          error: error instanceof Error ? error.message : "Canvas unavailable.",
          id,
        },
        type: "canvasResult",
      });
    }
  };

  const sendInit = async (): Promise<void> => {
    if (!mounted || !iframeReady || destroyed) {
      return;
    }
    initRevision += 1;
    const revision = initRevision;
    const appSource = await appSourcePromise;
    if (destroyed || appSource === null || revision !== initRevision) {
      return;
    }
    postToIframe({
      data: {
        appSource,
        appUrl: resolvedAppUrl.toString(),
        props: currentProps,
      },
      type: "init",
    });
    for (const [name, registration] of canvases) {
      postToIframe({
        data: { generation: registration.generation, name },
        type: "canvasAvailability",
      });
    }
    for (const payload of queuedPayloads.splice(0)) {
      postToIframe(payload);
    }
  };

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (
      event.source !== iframe.contentWindow ||
      !isBridgeMessage(event.data, channel)
    ) {
      return;
    }
    if (event.data.type === iframeReadyType) {
      iframeReady = true;
      void (async () => {
        try {
          await sendInit();
        } catch (error) {
          reportError(error);
        }
      })();
      return;
    }
    if (event.data.type !== sandboxMessageType) {
      return;
    }

    const result = v.safeParse(IframeToHostPayload, event.data.payload);
    if (!result.success) {
      reportError(
        new Error(
          `Invalid sandbox message: ${result.issues.map((issue) => issue.message).join("; ")}`
        )
      );
      return;
    }
    if (result.output.type === "callbackResult") {
      const { id, output, error } = result.output.data;
      const call = callbackCalls.get(id);
      if (call) {
        callbackCalls.delete(id);
        clearTimeout(call.timer);
        if (error === undefined) {
          call.resolve(output);
        } else {
          call.reject(new Error(error));
        }
      }
      return;
    }
    if (result.output.type === "canvasRequest") {
      connectCanvas(result.output.data);
      return;
    }
    if (result.output.type === "error") {
      reportError(new Error(result.output.data.message));
      return;
    }
    if (result.output.type === "toolRequest") {
      const { id, kind, path, input } = result.output.data;
      if (toolCalls.has(id) || toolCalls.size >= 32) {
        return;
      }
      toolCalls.add(id);
      const bridge = options.toolBridge;
      void (async () => {
        try {
          if (!bridge) {
            throw new Error("Tool bridge unavailable");
          }
          const output =
            kind === "client"
              ? await bridge.client(path, input)
              : await bridge.session(path);
          if (!destroyed) {
            postToIframe({ data: { id, output }, type: "toolResult" });
          }
        } catch {
          if (!destroyed) {
            postToIframe({
              data: { error: "Tool request failed", id },
              type: "toolResult",
            });
          }
        } finally {
          toolCalls.delete(id);
        }
      })();
      return;
    }
    if (result.output.type === "backendSessionRequest") {
      const { id, refresh } = result.output.data;
      if (sessionCalls.has(id) || sessionCalls.size >= 4) {
        return;
      }
      sessionCalls.add(id);
      void (async () => {
        try {
          if (!options.getBackendSession) {
            throw new Error("App backend is not configured");
          }
          const session = await options.getBackendSession({ refresh });
          if (!destroyed) {
            postToIframe({
              data: { id, session },
              type: "backendSessionResult",
            });
          }
        } catch (error) {
          const failure =
            error instanceof AppError
              ? error
              : new AppError(
                  "UNAVAILABLE",
                  "Unable to authorize the app backend"
                );
          if (!destroyed) {
            postToIframe({
              data: {
                error: { code: failure.code, message: failure.message },
                id,
              },
              type: "backendSessionResult",
            });
          }
        } finally {
          sessionCalls.delete(id);
        }
      })();
      return;
    }
    try {
      store.handleSandboxMessage(result.output);
    } catch (error) {
      reportError(error);
    }
  };

  window.addEventListener("message", handleMessage);

  return {
    ...store,
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      for (const { target } of canvases.values()) {
        target.close();
      }
      canvases.clear();
      canvasElements.clear();
      rejectCallbacks(new Error("TailorKit sandbox was destroyed."));
      window.removeEventListener("message", handleMessage);
      iframe.remove();
    },
    dispatch: async (payload): Promise<CallbackResult["output"]> => {
      v.parse(HostToIframePayload, payload);
      if (destroyed) {
        throw new Error("TailorKit sandbox was destroyed.");
      }
      const sendPayload = () => {
        if (iframeReady) {
          postToIframe(payload);
        } else {
          queuedPayloads.push(payload);
        }
      };
      if (payload.type !== "dispatchCallback") {
        sendPayload();
        return undefined;
      }
      const { id } = payload.data;
      if (callbackCalls.has(id)) {
        throw new Error("Duplicate callback request ID.");
      }
      const { promise, resolve, reject } =
        Promise.withResolvers<CallbackResult["output"]>();
      const timer = setTimeout(() => {
        callbackCalls.delete(id);
        const queuedIndex = queuedPayloads.indexOf(payload);
        if (queuedIndex !== -1) {
          queuedPayloads.splice(queuedIndex, 1);
        }
        reject(new Error("TailorKit callback timed out."));
      }, 30_000);
      callbackCalls.set(id, { reject, resolve, timer });
      try {
        sendPayload();
      } catch (error) {
        callbackCalls.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
      return await promise;
    },
    experimental_registerCanvas: (name, canvas, canvasOptions) => {
      if (
        destroyed ||
        name.length === 0 ||
        name.length > 128 ||
        canvases.has(name) ||
        canvasElements.has(canvas) ||
        canvases.size >= 8
      ) {
        throw new Error("Canvas registration unavailable or duplicated.");
      }
      const target = createCanvasTarget(canvas, canvasOptions);
      const registration = { generation: crypto.randomUUID(), target };
      canvases.set(name, registration);
      if (iframeReady) {
        postToIframe({
          data: { generation: registration.generation, name },
          type: "canvasAvailability",
        });
      }
      canvasElements.add(canvas);
      return () => {
        target.close();
        if (canvases.get(name) === registration) {
          canvases.delete(name);
          canvasElements.delete(canvas);
          if (iframeReady && !destroyed) {
            postToIframe({
              data: { generation: null, name },
              type: "canvasAvailability",
            });
          }
        }
      };
    },
    iframe,
    mount: () => {
      if (mounted || destroyed) {
        return;
      }
      mounted = true;
      appSourcePromise = fetchSource(fetchImplementation, resolvedAppUrl);
      (options.mountTarget ?? document.body).append(iframe);
      void (async () => {
        try {
          await sendInit();
        } catch (error) {
          reportError(error);
        }
      })();
    },
    setProps: (props) => {
      if (currentProps === props || destroyed) {
        return;
      }
      currentProps = props;
      void (async () => {
        try {
          await sendInit();
        } catch (error) {
          reportError(error);
        }
      })();
    },
  };
};
