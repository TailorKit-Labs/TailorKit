import { describe, expect, it, vi } from "vite-plus/test";

import type { RemoteNode } from "#protocol";

import { createRemoteUiStore } from "./store.js";

const tree = {
  children: [
    {
      callbacks: [
        {
          callback: "onClick",
          event: "patchsmithcallbackonclick",
          inputCount: 0,
        },
      ],
      children: [{ id: "text", kind: "text", text: "Save" }],
      id: "patchsmith-button",
      kind: "element",
      props: { disabled: false },
      type: "patchsmith-button",
    },
  ],
  id: "root",
  kind: "fragment",
} satisfies RemoteNode;

describe("createRemoteUiStore", () => {
  it("stores snapshots", () => {
    const store = createRemoteUiStore();

    store.handleSandboxMessage({
      data: { revision: 1, tree },
      type: "snapshot",
    });

    expect(store.getSnapshot()).toMatchObject(tree);
  });

  it("applies patch batches without replacing the entire remote tree over the wire", () => {
    const store = createRemoteUiStore();
    const listener = vi.fn<Parameters<typeof store.subscribe>[0]>();
    store.subscribe(listener);
    store.setSnapshot(tree, 1);

    store.handleSandboxMessage({
      data: {
        patches: [
          { nodeId: "text", op: "setText", text: "Saved" },
          {
            name: "disabled",
            nodeId: "patchsmith-button",
            op: "setProp",
            value: true,
          },
          { callbacks: [], nodeId: "patchsmith-button", op: "setCallbacks" },
        ],
        revision: 2,
      },
      type: "patches",
    });

    expect(store.getRevision()).toBe(2);
    expect(store.getSnapshot()).toMatchObject({
      children: [
        {
          callbacks: [],
          children: [{ text: "Saved" }],
          props: { disabled: true },
        },
      ],
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("can insert and remove nodes by id", () => {
    const store = createRemoteUiStore();
    store.setSnapshot(tree, 1);

    store.applyPatches([
      {
        node: { id: "suffix", kind: "text", text: "!" },
        op: "insert",
        parentId: "patchsmith-button",
      },
      {
        nodeId: "text",
        op: "remove",
      },
    ]);

    expect(store.getSnapshot()).toMatchObject({
      children: [
        {
          children: [{ id: "suffix", text: "!" }],
        },
      ],
    });
  });
});
