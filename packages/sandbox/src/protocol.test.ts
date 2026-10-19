import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { HostToIframePayload, IframeToHostPayload } from "./protocol.js";
import type { RemoteNode, RemotePatch } from "./protocol.js";

const text = { id: "text", kind: "text", text: "Hello" } satisfies RemoteNode;
const callback = { callback: "onClick", event: "click", inputCount: 1 };
const tree = {
  children: [
    {
      callbacks: [callback],
      children: [text],
      id: "button",
      kind: "element",
      props: { custom: undefined, disabled: false },
      type: "Button",
    },
  ],
  id: "root",
  kind: "fragment",
} satisfies RemoteNode;
const patches = [
  { beforeId: "text", node: tree, op: "insert", parentId: "root" },
  { nodeId: "text", op: "remove" },
  { name: "custom", nodeId: "button", op: "setProp", value: undefined },
  { name: "disabled", nodeId: "button", op: "removeProp" },
  { nodeId: "text", op: "setText", text: "Updated" },
  { callbacks: [callback], nodeId: "button", op: "setCallbacks" },
] satisfies RemotePatch[];

describe("sandbox protocol", () => {
  it.each([
    {
      data: {
        id: "session",
        session: {
          expiresAt: 123,
          token: "jwt",
          url: "https://runtime.test/rpc",
        },
      },
      type: "backendSessionResult",
    },
    {
      data: {
        error: { code: "UNAVAILABLE", message: "Unavailable" },
        id: "session",
      },
      type: "backendSessionResult",
    },
    {
      data: {
        appSource: "// app",
        appUrl: "app.js",
        props: { arbitrary: undefined },
      },
      type: "init",
    },
    {
      data: {
        args: [undefined, null, { custom: true }],
        event: "click",
        id: "callback",
        nodeId: "button",
      },
      type: "dispatchCallback",
    },
    {
      data: { event: "click", id: "callback", nodeId: "button" },
      type: "dispatchCallback",
    },
    { data: { timestamp: 1.5 }, type: "animationFrame" },
  ] satisfies HostToIframePayload[])(
    "accepts host message $type",
    (payload) => {
      expect(v.parse(HostToIframePayload, payload)).toEqual(payload);
    }
  );

  it.each([
    { data: { id: "canvas", name: "plot" }, type: "canvasRequest" },
    { data: { id: "session", refresh: true }, type: "backendSessionRequest" },
    { type: "ready" },
    {
      data: { id: "callback", output: { saved: true } },
      type: "callbackResult",
    },
    { data: { error: "Save failed", id: "callback" }, type: "callbackResult" },
    { data: { revision: 1, tree }, type: "snapshot" },
    { data: { patches, revision: 2 }, type: "patches" },
    { data: { message: "Failure" }, type: "error" },
    { data: {}, type: "requestAnimationFrame" },
  ] satisfies IframeToHostPayload[])(
    "accepts iframe message $type",
    (payload) => {
      expect(v.parse(IframeToHostPayload, payload)).toEqual(payload);
    }
  );

  it.each([
    { extra: true, type: "ready" },
    { data: { id: "canvas", name: "" }, type: "canvasRequest" },
    { data: { id: "canvas", name: "x".repeat(129) }, type: "canvasRequest" },
    {
      data: { appId: "another", id: "canvas", name: "plot" },
      type: "canvasRequest",
    },
    {
      data: { appId: "forged", id: "session", refresh: true },
      type: "backendSessionRequest",
    },
    {
      data: {
        revision: 1,
        tree: { ...tree, children: [{ ...text, extra: true }] },
      },
      type: "snapshot",
    },
    {
      data: { patches: [{ ...patches[0], extra: true }], revision: 1 },
      type: "patches",
    },
    {
      data: {
        patches: [
          {
            callbacks: [{ ...callback, extra: true }],
            nodeId: "button",
            op: "setCallbacks",
          },
        ],
        revision: 1,
      },
      type: "patches",
    },
    { data: { extra: true }, type: "requestAnimationFrame" },
    { data: { revision: "1", tree }, type: "snapshot" },
    {
      data: { revision: 1, tree: { ...text, kind: "unknown" } },
      type: "snapshot",
    },
    {
      data: { patches: [{ nodeId: "text", op: "unknown" }], revision: 1 },
      type: "patches",
    },
    {
      data: {
        patches: [{ name: "custom", nodeId: "button", op: "setProp" }],
        revision: 1,
      },
      type: "patches",
    },
  ])("rejects malformed iframe message %#", (payload) => {
    expect(v.safeParse(IframeToHostPayload, payload).success).toBe(false);
  });

  it("rejects arrays wherever the protocol requires an object", () => {
    const ready = Object.assign([], { type: "ready" });
    expect(v.safeParse(IframeToHostPayload, ready).success).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        data: [],
        type: "requestAnimationFrame",
      }).success
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        data: { revision: 1, tree: Object.assign([], text) },
        type: "snapshot",
      }).success
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        data: { patches: [Object.assign([], patches[1])], revision: 1 },
        type: "patches",
      }).success
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        data: {
          patches: [
            {
              callbacks: [Object.assign([], callback)],
              nodeId: "button",
              op: "setCallbacks",
            },
          ],
          revision: 1,
        },
        type: "patches",
      }).success
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        data: { appSource: "// app", appUrl: "app.js", props: [] },
        type: "init",
      }).success
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        data: Object.assign([], { timestamp: 1 }),
        type: "animationFrame",
      }).success
    ).toBe(false);
  });

  it.each([Number.NaN, Infinity, -Infinity])(
    "rejects non-finite numbers: %s",
    (value) => {
      expect(
        v.safeParse(HostToIframePayload, {
          data: { timestamp: value },
          type: "animationFrame",
        }).success
      ).toBe(false);
      expect(
        v.safeParse(HostToIframePayload, {
          data: {
            id: "session",
            session: {
              expiresAt: value,
              token: "jwt",
              url: "https://runtime.test",
            },
          },
          type: "backendSessionResult",
        }).success
      ).toBe(false);
      expect(
        v.safeParse(IframeToHostPayload, {
          data: { revision: value, tree },
          type: "snapshot",
        }).success
      ).toBe(false);
      expect(
        v.safeParse(IframeToHostPayload, {
          data: {
            patches: [
              {
                callbacks: [{ ...callback, inputCount: value }],
                nodeId: "button",
                op: "setCallbacks",
              },
            ],
            revision: 1,
          },
          type: "patches",
        }).success
      ).toBe(false);
    }
  );

  it.each(["", "s".repeat(129)])("rejects out-of-bounds session IDs", (id) => {
    expect(
      v.safeParse(HostToIframePayload, {
        data: { id },
        type: "backendSessionResult",
      }).success
    ).toBe(false);
    expect(
      v.safeParse(IframeToHostPayload, {
        data: { id, refresh: false },
        type: "backendSessionRequest",
      }).success
    ).toBe(false);
  });

  it("enforces session token limits and strict session fields", () => {
    const session = {
      expiresAt: 123,
      token: "t".repeat(8192),
      url: "https://runtime.test",
    };
    const payload = {
      data: { id: "s".repeat(128), session },
      type: "backendSessionResult",
    };
    expect(v.safeParse(HostToIframePayload, payload).success).toBe(true);
    expect(
      v.safeParse(HostToIframePayload, {
        ...payload,
        data: {
          ...payload.data,
          session: { ...session, token: "t".repeat(8193) },
        },
      }).success
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        ...payload,
        data: { ...payload.data, session: { ...session, extra: true } },
      }).success
    ).toBe(false);
    expect(
      v.safeParse(HostToIframePayload, {
        ...payload,
        data: {
          ...payload.data,
          error: { code: "UNKNOWN", message: "Failure" },
        },
      }).success
    ).toBe(false);
  });

  it.each([
    "https://runtime.test/rpc",
    "mailto:user@example.test",
    "custom:session",
    "  https://run\ntime.test/rpc  ",
  ])("preserves absolute URL validation: %s", (url) => {
    const payload = {
      data: { id: "session", session: { expiresAt: 123, token: "jwt", url } },
      type: "backendSessionResult",
    };
    expect(v.parse(HostToIframePayload, payload)).toEqual({
      ...payload,
      data: {
        ...payload.data,
        session: {
          ...payload.data.session,
          url: url.trim().replaceAll(/[\t\n\r]/gu, ""),
        },
      },
    });
  });

  it.each(["/rpc", "invalid", "https://"])(
    "rejects invalid session URLs: %s",
    (url) => {
      expect(
        v.safeParse(HostToIframePayload, {
          data: {
            id: "session",
            session: { expiresAt: 123, token: "jwt", url },
          },
          type: "backendSessionResult",
        }).success
      ).toBe(false);
    }
  );
});
