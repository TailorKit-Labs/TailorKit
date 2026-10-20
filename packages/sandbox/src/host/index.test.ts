// @vitest-environment happy-dom

import { createSessionProvider } from "@patchsmith/app/client";
import { asyncFixture } from "@patchsmith/config/testing";
import * as v from "valibot";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { iframeReadyType, sandboxMessageType } from "#bridge";
import { createIframeBackend } from "#iframe/backend";
import { HostToIframePayload } from "#protocol";

import { createIframeUiHost } from "./index.js";

const identity = {
  appId: "app",
  deploymentId: "deployment",
  expiresAt: Date.now() + 300_000,
  installationId: "app",
  projectId: "project",
  scope: { name: "workspace", value: { id: "workspace" } },
  subjectId: "principal",
  toolUrl: "https://host.test/api/patchsmith/tools/execute",
};

const getChannel = (iframe: HTMLIFrameElement): string => {
  const match = /data-patchsmith-channel="(?<channel>[a-f0-9]+)"/u.exec(
    iframe.srcdoc
  );

  if (!(match?.[1] !== undefined && match?.[1] !== null && match?.[1] !== "")) {
    throw new Error("Unable to find iframe channel.");
  }

  return match[1];
};

const emitFromIframe = (
  iframe: HTMLIFrameElement,
  data: MessageEvent<unknown>["data"]
): void => {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: iframe.contentWindow })
  );
};

const getContentWindow = (iframe: HTMLIFrameElement): Window => {
  if (!iframe.contentWindow) {
    throw new Error("Expected iframe content window.");
  }

  return iframe.contentWindow;
};

const createFetch = (source = "// bundled app client") =>
  vi.fn<typeof fetch>(async () => await Promise.resolve(new Response(source)));

describe("createIframeUiHost", () => {
  it("denies canvas requests unless the host registers a target", () => {
    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
    });

    host.mount();
    const postMessage = vi.spyOn(getContentWindow(host.iframe), "postMessage");
    const channel = getChannel(host.iframe);

    const message = {
      channel,
      payload: { data: { id: "request", name: "plot" }, type: "canvasRequest" },
      type: sandboxMessageType,
    };

    window.dispatchEvent(new MessageEvent("message", { data: message }));
    expect(postMessage).not.toHaveBeenCalled();
    emitFromIframe(host.iframe, { ...message, channel: "wrong" });
    expect(postMessage).not.toHaveBeenCalled();
    emitFromIframe(host.iframe, message);
    expect(postMessage).toHaveBeenCalledWith(
      {
        channel,
        payload: {
          data: {
            error: "Canvas surface is not registered by the host.",
            id: "request",
          },
          type: "canvasResult",
        },
        type: sandboxMessageType,
      },
      "*"
    );
    host.destroy();
    expect(() =>
      host.experimental_registerCanvas("plot", document.createElement("canvas"))
    ).toThrow("unavailable");
  });

  it("rejects oversized canvas targets before creating a rendering context", () => {
    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
    });

    const canvas = document.createElement("canvas");
    canvas.width = 4096;
    canvas.height = 4096;
    expect(() => host.experimental_registerCanvas("plot", canvas)).toThrow(
      "dimensions"
    );
    host.destroy();
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("loads app code directly into a hidden opaque-origin iframe", async () => {
    const fetch = createFetch();
    const host = createIframeUiHost("https://assets.test/app.js", { fetch });
    host.mount();
    const postMessage = vi.spyOn(getContentWindow(host.iframe), "postMessage");
    const channel = getChannel(host.iframe);

    emitFromIframe(host.iframe, { channel, type: iframeReadyType });

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          channel,
          payload: {
            data: {
              appSource: "// bundled app client",
              appUrl: "https://assets.test/app.js",
              props: undefined,
            },
            type: "init",
          },
          type: sandboxMessageType,
        },
        "*"
      );
    });

    expect(host.iframe.hidden).toBe(true);
    expect(host.iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(host.iframe.getAttribute("sandbox")).not.toContain(
      "allow-same-origin"
    );
    expect(host.iframe.srcdoc).toContain("connect-src http: https: ws: wss:");
    expect(host.iframe.srcdoc).toContain(
      "script-src 'unsafe-inline' 'unsafe-eval' data:;"
    );
    expect(host.iframe.srcdoc).toContain("worker-src 'none'");
    expect(host.iframe.srcdoc).not.toContain("new Worker");
    expect(fetch).toHaveBeenCalledWith(new URL("https://assets.test/app.js"), {
      credentials: "omit",
    });
  });

  it("queues callback events until the iframe is ready", async () => {
    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
    });

    host.mount();
    const postMessage = vi.spyOn(getContentWindow(host.iframe), "postMessage");
    const channel = getChannel(host.iframe);

    const callback = {
      data: { event: "patchsmithcallbackonclick", id: "queued", nodeId: "n:2" },
      type: "dispatchCallback" as const,
    };

    const pending = host.dispatch(callback);
    expect(postMessage).not.toHaveBeenCalled();
    emitFromIframe(host.iframe, { channel, type: iframeReadyType });

    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenLastCalledWith(
        { channel, payload: callback, type: sandboxMessageType },
        "*"
      );
    });
    emitFromIframe(host.iframe, {
      channel,
      payload: { data: { id: "queued" }, type: "callbackResult" },
      type: sandboxMessageType,
    });
    await expect(pending).resolves.toBeUndefined();
    host.destroy();
  });

  it("stores strictly validated snapshots received through the iframe bridge", () => {
    const onError =
      vi.fn<
        NonNullable<
          NonNullable<Parameters<typeof createIframeUiHost>[1]>["onError"]
        >
      >();

    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
      onError,
    });

    const channel = getChannel(host.iframe);

    emitFromIframe(host.iframe, {
      channel,
      payload: {
        data: {
          revision: 1,
          tree: {
            children: [{ id: "text", kind: "text", text: "Hello" }],
            id: "root",
            kind: "fragment",
          },
        },
        type: "snapshot",
      },
      type: sandboxMessageType,
    });
    expect(host.getSnapshot()).toMatchObject({ children: [{ text: "Hello" }] });

    emitFromIframe(host.iframe, {
      channel,
      payload: { data: { revision: "2", tree: {} }, type: "snapshot" },
      type: sandboxMessageType,
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(host.getRevision()).toBe(1);
  });

  it("rejects invalid outbound messages before queuing or posting them", async () => {
    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
    });

    host.mount();
    const postMessage = vi.spyOn(getContentWindow(host.iframe), "postMessage");

    const invalid = {
      data: { timestamp: Infinity },
      type: "animationFrame" as const,
    };

    await expect(host.dispatch(invalid)).rejects.toThrow();
    emitFromIframe(host.iframe, {
      channel: getChannel(host.iframe),
      type: iframeReadyType,
    });
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledTimes(1);
    });
    await expect(host.dispatch(invalid)).rejects.toThrow();
    expect(postMessage).toHaveBeenCalledTimes(1);
    host.destroy();
  });

  it("rejects messages from other windows", () => {
    const onError =
      vi.fn<
        NonNullable<
          NonNullable<Parameters<typeof createIframeUiHost>[1]>["onError"]
        >
      >();

    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
      onError,
    });

    const channel = getChannel(host.iframe);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel, payload: { type: "wat" }, type: sandboxMessageType },
        source: window,
      })
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("removes the iframe when destroyed", () => {
    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
    });

    host.mount();
    expect(document.body.contains(host.iframe)).toBe(true);
    host.destroy();
    expect(document.body.contains(host.iframe)).toBe(false);
  });
});

it("updates a mounted slot without fetching its app bundle again", async () => {
  const fetch = createFetch();

  const host = createIframeUiHost("https://assets.test/app.js", {
    fetch,
    props: { slot: "navbar", view: "/users" },
  });

  host.mount();
  const postMessage = vi.spyOn(getContentWindow(host.iframe), "postMessage");
  const channel = getChannel(host.iframe);
  emitFromIframe(host.iframe, { channel, type: iframeReadyType });
  await vi.waitFor(() => {
    expect(postMessage).toHaveBeenCalledTimes(1);
  });
  host.setProps({ slot: "navbar", view: "/users/detail" });
  await vi.waitFor(() => {
    expect(postMessage).toHaveBeenCalledTimes(2);
  });
  expect(postMessage.mock.calls[1]?.[0]).toMatchObject({
    payload: {
      data: {
        props: { slot: "navbar", view: "/users/detail" },
      },
    },
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(host.iframe.isConnected).toBe(true);
  host.destroy();
});

describe("backend JWT bridge", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });
  it("delivers platform session identity through the provider and strict iframe protocol", async () => {
    const session = {
      expiresAt: identity.expiresAt,
      identity,
      token: "platform-token",
      url: "https://runtime.test/rpc",
    };

    const getBackendSession = createSessionProvider({
      appId: identity.appId,
      baseUrl: "https://host.test/api/patchsmith",
      fetch: asyncFixture(() =>
        Response.json({
          ...session,
          identity: {
            ...identity,
            appShortId: "short-app",
            projectShortId: "short-project",
          },
        })
      ),
    });

    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
      getBackendSession,
    });

    host.mount();
    const channel = getChannel(host.iframe);

    const bridge = createIframeBackend((data) => {
      emitFromIframe(host.iframe, {
        channel,
        payload: { data, type: "backendSessionRequest" },
        type: sandboxMessageType,
      });
    });

    vi.spyOn(getContentWindow(host.iframe), "postMessage").mockImplementation(
      (message) => {
        const { payload: parsed } = v.parse(
          v.object({ payload: HostToIframePayload }),
          message
        );

        if (parsed.type === "backendSessionResult") {
          bridge.receive(parsed.data);
        }
      }
    );

    try {
      await expect(bridge.getSession({ refresh: false })).resolves.toEqual(
        session
      );
    } finally {
      bridge.close();
      host.destroy();
    }
  });
  it("mounts without fetching a session and renews scoped sessions", async () => {
    const session = {
      expiresAt: Date.now() + 120_000,
      identity,
      token: "scoped-token",
      url: "https://runtime.test/rpc",
    };

    const getBackendSession = vi.fn().mockResolvedValue(session);

    const onError =
      vi.fn<
        NonNullable<
          NonNullable<Parameters<typeof createIframeUiHost>[1]>["onError"]
        >
      >();

    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
      getBackendSession,
      onError,
    });

    host.mount();
    await vi.waitFor(() => {
      expect(host.iframe.isConnected).toBe(true);
    });
    expect(host.iframe.srcdoc).toContain("connect-src http: https: ws: wss:");
    expect(host.iframe.srcdoc).not.toContain("scoped-token");
    const postMessage = vi.spyOn(getContentWindow(host.iframe), "postMessage");
    const channel = getChannel(host.iframe);
    // An app cannot choose another installation or project in the bridge request.
    emitFromIframe(host.iframe, {
      channel,
      payload: {
        data: { appId: "another-app", id: "forged", refresh: true },
        type: "backendSessionRequest",
      },
      type: sandboxMessageType,
    });
    expect(getBackendSession).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    emitFromIframe(host.iframe, {
      channel,
      payload: {
        data: { id: "renew", refresh: true },
        type: "backendSessionRequest",
      },
      type: sandboxMessageType,
    });
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        {
          channel,
          payload: {
            data: { id: "renew", session },
            type: "backendSessionResult",
          },
          type: sandboxMessageType,
        },
        "*"
      );
    });
    expect(getBackendSession).toHaveBeenLastCalledWith({ refresh: true });
    host.destroy();
  });
  it("keeps client-only apps working when no backend session exists", async () => {
    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
      getBackendSession: vi.fn().mockRejectedValue(new Error("No backend")),
    });

    host.mount();
    await vi.waitFor(() => {
      expect(host.iframe.isConnected).toBe(true);
    });
    expect(host.iframe.srcdoc).toContain("connect-src http: https: ws: wss:");
    host.destroy();
  });
});

it.each(["backend-first", "tools-first"])(
  "isolates tool and backend request limits and cleanup (%s)",
  async (order) => {
    const session = {
      expiresAt: Date.now() + 120_000,
      identity,
      token: "token",
      url: "https://runtime.test/rpc",
    };

    let complete!: () => void;

    const pending = (async () => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers<ReturnType<() => void>>();

      try {
        complete = resolve;
      } catch (error) {
        rejectPending(error);
      }

      await pendingPromise;
    })();

    const client = vi.fn(async () => {
      await pending;

      return "output";
    });

    const getBackendSession = vi.fn(async () => {
      await pending;

      return session;
    });

    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
      getBackendSession,
      toolBridge: { client, session: vi.fn().mockResolvedValue(session) },
    });

    host.mount();
    const postMessage = vi.spyOn(getContentWindow(host.iframe), "postMessage");
    const channel = getChannel(host.iframe);

    const send = (
      type: "toolRequest" | "backendSessionRequest",
      id: string
    ) => {
      emitFromIframe(host.iframe, {
        channel,
        payload: {
          data:
            type === "toolRequest"
              ? { id, input: "input", kind: "client", path: "ui.open" }
              : { id, refresh: false },
          type,
        },
        type: sandboxMessageType,
      });
    };

    try {
      const types =
        order === "backend-first"
          ? (["backendSessionRequest", "toolRequest"] as const)
          : (["toolRequest", "backendSessionRequest"] as const);

      for (const type of types) {
        for (
          let index = 0;
          index < (type === "toolRequest" ? 32 : 4);
          index += 1
        ) {
          send(type, String(index));
        }
      }

      expect(client).toHaveBeenCalledTimes(32);
      expect(getBackendSession).toHaveBeenCalledTimes(4);
      // Each kind rejects duplicates and over-capacity requests independently.
      send("toolRequest", "0");
      send("backendSessionRequest", "0");
      send("toolRequest", "overflow");
      send("backendSessionRequest", "overflow");
      expect(client).toHaveBeenCalledTimes(32);
      expect(getBackendSession).toHaveBeenCalledTimes(4);
      complete();
      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledTimes(36);
      });
      send("toolRequest", "0");
      send("backendSessionRequest", "0");
      expect(client).toHaveBeenCalledTimes(33);
      expect(getBackendSession).toHaveBeenCalledTimes(5);
      await vi.waitFor(() => {
        expect(postMessage).toHaveBeenCalledTimes(38);
      });
    } finally {
      complete();
      host.destroy();
      vi.restoreAllMocks();
    }
  }
);

it("correlates concurrent callback results and rejects failures", async () => {
  const host = createIframeUiHost("https://assets.test/app.js", {
    fetch: createFetch(),
  });

  host.mount();
  const channel = getChannel(host.iframe);

  const first = host.dispatch({
    data: { event: "save", id: "first", nodeId: "n:1" },
    type: "dispatchCallback",
  });

  const second = host.dispatch({
    data: { event: "save", id: "second", nodeId: "n:1" },
    type: "dispatchCallback",
  });

  const failure = host.dispatch({
    data: { event: "save", id: "failure", nodeId: "n:1" },
    type: "dispatchCallback",
  });

  const failed = expect(failure).rejects.toThrow("Save failed");

  const reply = (data: { id: string; output?: unknown; error?: string }) => {
    emitFromIframe(host.iframe, {
      channel,
      payload: { data, type: "callbackResult" },
      type: sandboxMessageType,
    });
  };

  reply({ id: "unknown", output: "ignored" });
  reply({ id: "second", output: false });
  reply({ id: "first", output: { saved: true } });
  reply({ error: "Save failed", id: "failure" });
  await expect(first).resolves.toEqual({ saved: true });
  await expect(second).resolves.toBe(false);
  await failed;
  host.destroy();
});

it("rejects pending callbacks on destruction and timeout", async () => {
  vi.useFakeTimers();

  try {
    const host = createIframeUiHost("https://assets.test/app.js", {
      fetch: createFetch(),
    });

    const timed = host.dispatch({
      data: { event: "save", id: "timed", nodeId: "n:1" },
      type: "dispatchCallback",
    });

    const timeout = expect(timed).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await timeout;

    const pending = host.dispatch({
      data: { event: "save", id: "pending", nodeId: "n:1" },
      type: "dispatchCallback",
    });

    const destroyed = expect(pending).rejects.toThrow("destroyed");
    host.destroy();
    await destroyed;
    await expect(
      host.dispatch({
        data: { event: "save", id: "late", nodeId: "n:1" },
        type: "dispatchCallback",
      })
    ).rejects.toThrow("destroyed");
  } finally {
    vi.useRealTimers();
  }
});

it("rejects queued callbacks when the app fails to load", async () => {
  const onError = vi.fn<(error: Error) => void>();

  const host = createIframeUiHost("https://assets.test/app.js", {
    fetch: async () => {
      await Promise.resolve();
      throw new Error("App unavailable");
    },
    onError,
  });

  host.mount();

  const pending = host.dispatch({
    data: { event: "save", id: "queued", nodeId: "n:1" },
    type: "dispatchCallback",
  });

  const rejected = expect(pending).rejects.toThrow("App unavailable");
  emitFromIframe(host.iframe, {
    channel: getChannel(host.iframe),
    type: iframeReadyType,
  });
  await rejected;
  expect(onError).toHaveBeenCalled();
  host.destroy();
});
