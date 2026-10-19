import type { IframeToHostPayload, RemoteNode, RemotePatch } from "#protocol";

const hasText = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value.length > 0;

export interface RemoteUiStore {
  applyPatches: (patches: readonly RemotePatch[]) => void;
  getRevision: () => number;
  getSnapshot: () => RemoteNode | null;
  handleSandboxMessage: (message: IframeToHostPayload) => void;
  setSnapshot: (tree: RemoteNode, revision: number) => void;
  subscribe: (listener: () => void) => () => void;
}

const cloneNode = <TNode extends RemoteNode>(node: TNode): TNode =>
  structuredClone(node);

const findNode = (node: RemoteNode, nodeId: string): RemoteNode | null => {
  if (node.id === nodeId) {
    return node;
  }
  if (node.kind === "text") {
    return null;
  }
  for (const child of node.children) {
    const match = findNode(child, nodeId);
    if (match) {
      return match;
    }
  }
  return null;
};

const removeNode = (node: RemoteNode, nodeId: string): boolean => {
  if (node.kind === "text") {
    return false;
  }
  const index = node.children.findIndex((child) => child.id === nodeId);
  if (index !== -1) {
    node.children.splice(index, 1);
    return true;
  }
  return node.children.some((child) => removeNode(child, nodeId));
};

const applyPatch = (root: RemoteNode, patch: RemotePatch): void => {
  switch (patch.op) {
    case "insert": {
      const parent = findNode(root, patch.parentId);
      if (!parent || parent.kind === "text") {
        return;
      }
      const beforeIndex = hasText(patch.beforeId)
        ? parent.children.findIndex((child) => child.id === patch.beforeId)
        : -1;
      if (beforeIndex === -1) {
        parent.children.push(cloneNode(patch.node));
      } else {
        parent.children.splice(beforeIndex, 0, cloneNode(patch.node));
      }
      break;
    }
    case "remove": {
      removeNode(root, patch.nodeId);
      break;
    }
    case "setProp": {
      const node = findNode(root, patch.nodeId);
      if (node?.kind === "element") {
        node.props[patch.name] = patch.value;
      }
      break;
    }
    case "removeProp": {
      const node = findNode(root, patch.nodeId);
      if (node?.kind === "element") {
        Reflect.deleteProperty(node.props, patch.name);
      }
      break;
    }
    case "setText": {
      const node = findNode(root, patch.nodeId);
      if (node?.kind === "text") {
        node.text = patch.text;
      }
      break;
    }
    case "setCallbacks": {
      const node = findNode(root, patch.nodeId);
      if (node?.kind === "element") {
        node.callbacks = patch.callbacks;
      }
      break;
    }
    default: {
      break;
    }
  }
};

export const createRemoteUiStore = (): RemoteUiStore => {
  const listeners = new Set<() => void>();
  let revision = 0;
  let snapshot: RemoteNode | null = null;

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    applyPatches: (patches) => {
      if (!snapshot) {
        return;
      }
      const nextSnapshot = cloneNode(snapshot);
      for (const patch of patches) {
        applyPatch(nextSnapshot, patch);
      }
      snapshot = nextSnapshot;
      notify();
    },
    getRevision: () => revision,
    getSnapshot: () => snapshot,
    handleSandboxMessage(message) {
      switch (message.type) {
        case "snapshot": {
          this.setSnapshot(message.data.tree, message.data.revision);
          break;
        }
        case "patches": {
          ({ revision } = message.data);
          this.applyPatches(message.data.patches);
          break;
        }
        case "error": {
          throw new Error(message.data.message);
        }
        case "canvasRequest":
        case "callbackResult":
        case "toolRequest":
        case "backendSessionRequest":
        case "ready":
        case "requestAnimationFrame": {
          break;
        }
        default: {
          break;
        }
      }
    },
    setSnapshot: (tree, nextRevision) => {
      snapshot = cloneNode(tree);
      revision = nextRevision;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
