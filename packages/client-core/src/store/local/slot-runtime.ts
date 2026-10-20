import type { ToolBridge, Session, ViewInstance } from "@patchsmith/app/client";
import type { ViewStatus } from "@patchsmith/core/views";
import type { RemoteProps } from "@patchsmith/sandbox/protocol";
import { atom } from "nanostores";

import type { RuntimeRenderSlotProps, SlotState } from "#client/slot-types";
import { resolveSlotView, selectSlotView } from "#client/slot-view";
import { toBaseUrl } from "#client/url";
import { createValueMemo } from "#client/value-memo";
import { serializeCacheKey } from "#store/fetch/cache";
import type { SlotItem } from "#store/fetch/slot";
import { createAppViewsQuery } from "#store/query";
import { createSnapshotStore } from "#store/snapshot-store";
import type { PatchsmithStore } from "#store/store";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

export type SlotRuntimeOptions = RuntimeRenderSlotProps &
  (
    | { mode: "managed" }
    | {
        mode: "controlled";
        view: string;
        context?: unknown;
        status: ViewStatus;
        instance?: ViewInstance;
      }
  );

export type SlotRuntimeSnapshot =
  | { status: "hidden" }
  | { status: "loading"; message: string }
  | { status: "error"; error: Error }
  | {
      status: "render";
      appUrl: string;
      hostKey: string | number;
      props: RemoteProps;
      toolBridge: ToolBridge;
      getBackendSession: (options: { refresh: boolean }) => Promise<Session>;
    };

const hidden: SlotRuntimeSnapshot = { status: "hidden" };

const loading: SlotRuntimeSnapshot = {
  message: "Loading view…",
  status: "loading",
};

const failure = (message: string): SlotRuntimeSnapshot => ({
  error: new Error(message),
  status: "error",
});

/** Resolve a managed or controlled slot; adapters only render its snapshot. */
export const createSlotRuntime = (
  store: PatchsmithStore,
  initial: SlotRuntimeOptions
) => {
  const memoInput = createValueMemo<SlotRuntimeOptions>();
  const input = atom(memoInput(initial));
  let queryKey: string | undefined;
  let query: ReturnType<typeof createAppViewsQuery> | null = null;
  let previousSnapshot: SlotRuntimeSnapshot;
  let snapshotKey: string | undefined;

  const getQuery = () => {
    const options = input.get();

    if (
      options.mode !== "managed" ||
      options.instanceKey === undefined ||
      store.views.state.get() === null
    ) {
      return null;
    }

    const key = serializeCacheKey([options.app, options.slot]);

    if (key !== queryKey) {
      queryKey = key;
      query = createAppViewsQuery(store, options.app, options.slot);
    }

    return query;
  };

  // oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
  const resolve = (): SlotRuntimeSnapshot => {
    const options = input.get();
    const { app, slot } = options;
    const active = store.views.state.get();
    let viewState: SlotState;

    if (options.mode === "managed") {
      if (active === null) {
        return hidden;
      }

      viewState = active;

      if (options.instanceKey !== undefined) {
        const instances = requireValue(getQuery()).state.get();

        if (instances.isPending) {
          return loading;
        }

        if (instances.error) {
          return { error: instances.error, status: "error" };
        }

        const schema = store.contract;

        if (schema.slots[slot]?.multiple !== true) {
          return failure(`Slot "${slot}" does not support instances.`);
        }

        const instance = instances.data?.find(
          (item): item is SlotItem<true> =>
            "key" in item && item.key === options.instanceKey
        );

        if (!instance) {
          return failure(
            `View instance "${options.instanceKey}" is unavailable.`
          );
        }

        const resolved = instances.isSuccess
          ? resolveSlotView(app.views ?? [], slot, active, schema)
          : null;

        if (resolved?.status !== "ready") {
          return hidden;
        }

        viewState = {
          context: resolved.context,
          controlled: true,
          instance: {
            data: instance.data,
            key: instance.key,
            metadata: instance.metadata,
          },
          status: "ready",
          view: resolved.view,
        };
      }
    } else {
      viewState = {
        context: options.status === "ready" ? options.context : undefined,
        controlled: true,
        status: options.status,
        view: options.view,
      };

      if (options.status === "ready" && options.instance) {
        viewState.instance = options.instance;
      }

      if (
        options.status === "ready" &&
        !options.instance &&
        app.views?.some(
          (view) =>
            view.slot === slot &&
            view.path === options.view &&
            view.instances === true &&
            !view.disabled
        ) === true
      ) {
        return failure(
          "A view instance is required. Pass instance to RenderSlot.Controlled."
        );
      }
    }

    const schema = store.contract;

    const appUrl = (() => {
      if (
        app.clientPath !== undefined &&
        app.clientPath !== null &&
        app.clientPath !== ""
      ) {
        return new URL(app.clientPath, store.baseUrl);
      }

      if (
        store.assetsBaseUrl !== undefined &&
        store.assetsBaseUrl !== "" &&
        app.projectId !== undefined &&
        app.projectId !== null &&
        app.projectId !== "" &&
        app.currentDeployment?.id !== undefined &&
        app.currentDeployment?.id !== null &&
        app.currentDeployment?.id !== ""
      ) {
        return new URL(
          `projects/${app.projectId}/apps/${app.id}/deployments/${app.currentDeployment.id}/client/client.js`,
          toBaseUrl(store.assetsBaseUrl)
        );
      }

      return null;
    })();

    if (appUrl === null) {
      return hidden;
    }

    const multiple = schema.slots[slot]?.multiple === true;

    if ("controlled" in viewState && viewState.status === "ready") {
      if (multiple && !viewState.instance) {
        return failure(
          "A view instance is required. Pass instance to RenderSlot.Controlled."
        );
      }

      if (!multiple && viewState.instance) {
        return failure(`Slot "${slot}" does not support instances.`);
      }
    }

    if (!("controlled" in viewState)) {
      const selected = selectSlotView(
        app.views ?? [],
        slot,
        viewState.view,
        schema
      );

      if (selected?.instances && !multiple) {
        return failure(`Slot "${slot}" does not support instances.`);
      }

      if (multiple) {
        return failure(
          "A view instance key is required. Pass instanceKey to RenderSlot."
        );
      }
    }

    return {
      appUrl: appUrl.toString(),
      getBackendSession: store.client.endpoints.getSessionProvider(app),
      hostKey: appUrl.toString(),
      props: {
        ...viewState,
        declaredViews: Object.keys(schema.views),
        slot,
        supportedViews: schema.slots[slot]?.views ?? [],
      },
      status: "render",
      toolBridge: store.client.endpoints.getToolBridge(app),
    };
  };

  const state = createSnapshotStore(
    () => {
      const snapshot = resolve();

      const key =
        snapshot.status === "error"
          ? JSON.stringify(["error", snapshot.error.message])
          : JSON.stringify(snapshot);

      if (
        key !== snapshotKey ||
        (snapshot.status === "render" &&
          previousSnapshot?.status === "render" &&
          snapshot.getBackendSession !== previousSnapshot.getBackendSession)
      ) {
        snapshotKey = key;
        previousSnapshot = snapshot;
      }

      return previousSnapshot;
    },
    (listener) => {
      let active = true;
      let updating = false;
      let queued = false;
      let observedQuery: typeof query = null;
      let stopQuery: (() => void) | undefined;

      const refresh = () => {
        if (!active) {
          return;
        }

        if (updating) {
          queued = true;

          return;
        }

        updating = true;

        while (true) {
          queued = false;
          const nextQuery = getQuery();

          if (nextQuery !== observedQuery) {
            const stopPrevious = stopQuery;
            observedQuery = nextQuery;
            stopQuery = nextQuery?.state.listen(refresh);
            stopPrevious?.();
          }

          listener();

          if (!queued || !active) {
            break;
          }
        }

        updating = false;
      };

      const stopInput = input.listen(refresh);
      const stopView = store.views.state.listen(refresh);
      refresh();

      return () => {
        active = false;
        stopInput();
        stopView();
        stopQuery?.();
      };
    }
  );

  return {
    setInput: (options: SlotRuntimeOptions) => {
      input.set(memoInput(options));
    },
    state,
  };
};
