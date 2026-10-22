import type { ViewResolutionWarning } from "@patchsmith/core/views";
import { computed } from "nanostores";

import { matchesApp } from "#client/apps";
import { normalizeScopeSelection } from "#client/scope-query";
import { slotActiveView } from "#client/slot-active-view";
import { createValueMemo } from "#client/value-memo";
import { refetchViews } from "#client/views";
import type { ViewsQueryOptions } from "#client/views";
import type { PatchsmithApp } from "#types";

import type { FetchSnapshot } from "./fetch/cache";
import { serializeCacheKey } from "./fetch/cache";
import { createSlotStore } from "./fetch/slot";
import type { SlotItem } from "./fetch/slot";
import { createSnapshotStore, switchStore } from "./snapshot-store";
import type { PatchsmithStore } from "./store";

export interface AppsQueryOptions<TScopeNames extends string = string> {
  scopes?: readonly TScopeNames[];
  appIds?: readonly string[];
}

export interface QueryResult<T> {
  data: T | undefined;
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
  isError: boolean;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
}

export type ViewsQueryResult<TMultiple extends boolean = boolean> = QueryResult<
  SlotItem<TMultiple>[]
> & { warnings: ViewResolutionWarning[] };

export const appsQueryKey = (options: AppsQueryOptions): string =>
  serializeCacheKey([
    normalizeScopeSelection(options.scopes).key,
    normalizeScopeSelection(options.appIds).key,
  ]);

const result = <T>(
  snapshot: Pick<FetchSnapshot<T>, "data" | "error" | "status" | "isFetching">,
  refetch: () => Promise<void>
): QueryResult<T> => ({
  data: snapshot.data,
  error: snapshot.error,
  isError: snapshot.status === "error",
  isFetching: snapshot.isFetching,
  isLoading: snapshot.status === "loading",
  isPending: snapshot.status === "idle" || snapshot.status === "loading",
  isSuccess: snapshot.status === "ready",
  refetch,
  status: snapshot.status,
});

/** Discover and filter apps, with the same result shape in every framework. */
export const createAppsQuery = (
  store: PatchsmithStore,
  options: AppsQueryOptions = {}
) => {
  const refetch = async () => {
    await store.fetchApps({ force: true });
  };

  let previous: ReturnType<typeof store.getAppsSnapshot> | undefined;
  let snapshot: QueryResult<PatchsmithApp[]>;

  const state = createSnapshotStore(
    () => {
      const current = store.fetch.apps.state.get();

      if (current !== previous) {
        previous = current;
        snapshot = result(
          {
            ...current,
            data:
              current.status === "ready"
                ? current.apps.filter((app) =>
                    matchesApp(app, options.scopes, options.appIds)
                  )
                : undefined,
          },
          refetch
        );
      }

      return snapshot;
    },
    (listener) => {
      const stop = store.fetch.apps.state.listen(listener);
      void store.fetchApps();

      return stop;
    }
  );

  return { fetch: store.fetchApps, refetch, state };
};

const viewsQuery = (store: PatchsmithStore, options: ViewsQueryOptions) => {
  const refetch = async () => {
    await refetchViews(store, options);
  };

  const memoActive = createValueMemo<ReturnType<typeof slotActiveView>>();

  const activeView = computed(store.views.state, (active) =>
    memoActive(slotActiveView(store.contract, options.slot, active))
  );

  const selection = computed(activeView, (active) => {
    const slot = createSlotStore(store.client, {
      ...options,
      activeView: active,
    });

    let previous: ReturnType<typeof slot.getSnapshot> | undefined;
    let snapshot: ViewsQueryResult;

    return createSnapshotStore(
      () => {
        const current = slot.state.get();

        if (current !== previous) {
          previous = current;
          snapshot = {
            ...result(current, refetch),
            warnings: current.warnings,
          };
        }

        return snapshot;
      },
      (listener) => {
        const stop = slot.state.listen(listener);
        void slot.fetch();

        return stop;
      }
    );
  });

  return { refetch, state: switchStore(selection) };
};

/** Resolve a slot over HTTP as registered context changes. */
export const createViewsQuery = (
  store: PatchsmithStore,
  options: ViewsQueryOptions
) => viewsQuery(store, options);

/** The host still authorizes and discovers the explicitly selected installation. */
export const createAppViewsQuery = (
  store: PatchsmithStore,
  app: PatchsmithApp,
  slot: string
) => viewsQuery(store, { appIds: [app.id], slot });
