import { createIframeUiHost } from "@tailorkit/sandbox/host";
import type {
  IframeUiHost,
  IframeUiHostOptions,
} from "@tailorkit/sandbox/host";
import type {
  RemoteProps,
  HostToIframePayload,
  RemoteElementNode,
} from "@tailorkit/sandbox/protocol";
import { atom, batch, computed } from "nanostores";

import { NodeStore } from "./node-store";

// Framework adapters supply heterogeneous component constructors; the core store keeps them opaque.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Only the owning React or Preact adapter interprets registry values.
export type RemoteComponentRegistry = Record<string, unknown>;

export interface RemoteViewSnapshot {
  error: Error | null;
  generation: number;
  status: "starting" | "ready" | "error";
}

export interface RemoteViewStoreOptions {
  components?: RemoteComponentRegistry;
  props?: RemoteProps;
}

export interface RemoteViewMountOptions extends Omit<
  IframeUiHostOptions,
  "onError" | "props"
> {
  appUrl: string | URL;
}

interface RunningView {
  host: IframeUiHost | null;
  unsubscribe: (() => void) | null;
  stopped: boolean;
}

/** One remote app's state and host lifecycle, independent of its rendering framework. */
export const createRemoteViewStore = (
  options: RemoteViewStoreOptions = {},
  createHost: typeof createIframeUiHost = createIframeUiHost
) => {
  const nodes = new NodeStore();
  const components = atom(options.components ?? {});
  const state = atom<RemoteViewSnapshot>({
    error: null,
    generation: 0,
    status: "starting",
  });
  let { props } = options;
  let current: RunningView | null = null;

  const stop = (run: RunningView) => {
    if (run.stopped) {
      return;
    }
    run.stopped = true;
    if (current === run) {
      current = null;
    }
    run.unsubscribe?.();
    run.host?.destroy();
  };

  const reset = () => {
    batch(() => {
      nodes.clear();
      state.set({
        error: null,
        generation: state.get().generation,
        status: "starting",
      });
    });
  };

  return {
    components,
    destroy: () => {
      if (current) {
        stop(current);
      }
      reset();
    },
    dispatch: async (
      payload: HostToIframePayload
    ): ReturnType<IframeUiHost["dispatch"]> => {
      if (!current?.host) {
        throw new Error("TailorKit remote view is not mounted.");
      }
      return await current.host.dispatch(payload);
    },
    mount: ({
      appUrl,
      ...hostOptions
    }: RemoteViewMountOptions): (() => void) => {
      if (current) {
        stop(current);
      }
      const generation = state.get().generation + 1;
      batch(() => {
        nodes.clear();
        state.set({ error: null, generation, status: "starting" });
      });
      const run: RunningView = {
        host: null,
        stopped: false,
        unsubscribe: null,
      };
      current = run;
      const reportError = (error: Error) => {
        if (current !== run || run.stopped) {
          return;
        }
        console.error("TailorKit remote app failed", error);
        state.set({ error, generation, status: "error" });
      };
      try {
        const host = createHost(appUrl, {
          ...hostOptions,
          onError: reportError,
          props,
        });
        run.host = host;
        run.unsubscribe = host.subscribe(() => {
          if (current !== run || run.stopped) {
            return;
          }
          const tree = host.getSnapshot();
          if (tree !== null) {
            batch(() => {
              nodes.setSnapshot(tree);
              const previous = state.get();
              if (previous.status !== "ready") {
                state.set({ error: null, generation, status: "ready" });
              }
            });
          }
        });
        host.mount();
      } catch (error) {
        reportError(error instanceof Error ? error : new Error(String(error)));
        stop(run);
      }
      return () => {
        if (current !== run) {
          return;
        }
        stop(run);
        reset();
      };
    },
    nodes,
    selectComponent: (name: string) =>
      computed(components, (registry) => registry[name]),
    setComponents: (registry: RemoteComponentRegistry) => {
      components.set(registry);
    },
    setProps: (next: RemoteProps | undefined) => {
      props = next;
      current?.host?.setProps(next);
    },
    state,
  };
};

export type RemoteViewStore = ReturnType<typeof createRemoteViewStore>;

/** Bind remote callbacks to their protocol payload without framework event arguments leaking. */
export const createRemoteElementProps = (
  node: RemoteElementNode,
  dispatch: RemoteViewStore["dispatch"]
): RemoteProps => {
  const props: RemoteProps = { ...node.props };
  for (const binding of node.callbacks ?? []) {
    props[binding.callback] = async (...args: unknown[]) =>
      await dispatch({
        data: {
          args: args.slice(0, binding.inputCount),
          event: binding.event,
          id: crypto.randomUUID(),
          nodeId: node.id,
        },
        type: "dispatchCallback",
      });
  }
  return props;
};
