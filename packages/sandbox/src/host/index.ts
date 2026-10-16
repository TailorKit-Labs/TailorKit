import type { ToolBridge } from "@tailorkit/app/client";
import { AppError } from "@tailorkit/app/client/connection";
import type { Session } from "@tailorkit/app/client/connection";
import * as v from "valibot";
import iframeSource from "virtual:tailorkit-iframe";

import { iframeReadyType, sandboxMessageType } from "#bridge";
import type {
  RemoteProps,
  HostToIframePayload as HostToIframePayloadType,
} from "#protocol";
import { HostToIframePayload, IframeToHostPayload } from "#protocol";

import { createRemoteUiStore } from "./store.js";
import type { RemoteUiStore } from "./store.js";

export { type RemoteUiStore } from "./store.js";
export { createRemoteUiStore } from "./store.js";

interface IframeBridgeMessage {
  channel: string;
  payload?: unknown;
  type: string;
}

export interface IframeUiHost extends RemoteUiStore {
  destroy: () => void;
  dispatch: (payload: HostToIframePayloadType) => void;
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
  const queuedPayloads: HostToIframePayloadType[] = [];
  let appSourcePromise: Promise<string> | null = null;
  let destroyed = false;
  let iframeReady = false;
  let mounted = false;
  let currentProps = options.props;
  let initRevision = 0;

  configureIframe(iframe, channel);

  const reportError = (cause: unknown): void => {
    options.onError?.(
      cause instanceof Error ? cause : new Error(String(cause))
    );
  };

  const postToIframe = (payload: HostToIframePayloadType): void => {
    iframe.contentWindow?.postMessage(
      { channel, payload, type: sandboxMessageType },
      "*"
    );
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
      queuedPayloads.length = 0;
      window.removeEventListener("message", handleMessage);
      iframe.remove();
    },
    dispatch: (payload) => {
      v.parse(HostToIframePayload, payload);
      if (!iframeReady) {
        queuedPayloads.push(payload);
        return;
      }
      postToIframe(payload);
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
