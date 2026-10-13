import { computed } from "nanostores";
import type { ReadableAtom } from "nanostores";

import { matchesApp } from "../client/apps";
import { normalizeScopeSelection } from "../client/scope-query";
import { refetchViews } from "../client/views";
import type { ViewsQueryOptions } from "../client/views";
import type { TailorKitApp } from "../types";
import type { FetchSnapshot } from "./fetch/cache";
import { serializeCacheKey } from "./fetch/cache";
import { createSlotStore } from "./fetch/slot";
import type { SlotItem } from "./fetch/slot";
import { createSnapshotStore, switchStore } from "./snapshot-store";
import type { TailorKitStore } from "./store";

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
>;

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
  store: TailorKitStore,
  options: AppsQueryOptions = {}
) => {
  const refetch = () => store.fetchApps({ force: true });
  let previous: ReturnType<typeof store.getAppsSnapshot> | undefined;
  let snapshot: QueryResult<TailorKitApp[]>;
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

const viewsQuery = (
  store: TailorKitStore,
  options: ViewsQueryOptions,
  app?: TailorKitApp
) => {
  let previousKey: string | undefined;
  let previousError: Error | null | undefined;
  let selected: ReadableAtom<ViewsQueryResult>;
  let query: ReturnType<typeof createSlotStore>;
  const refetch = () => {
    // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
    selection.get();
    return app ? query.fetch({ force: true }) : refetchViews(store, options);
  };
  const selection = computed(
    [store.fetch.apps.state, store.views.state],
    (discovery, active) => {
      const apps = (() => {
        if (app) {
          return [app];
        }
        if (discovery.status === "ready") {
          return discovery.apps.filter((candidate) =>
            matchesApp(candidate, options.scopes, options.appIds)
          );
        }
        return [];
      })();
      const appsStatus = app ? "ready" : discovery.status;
      const appsError = app ? null : discovery.error;
      const activeView =
        store.contract.slots[options.slot]?.multiple === true ? active : null;
      const key = serializeCacheKey([
        apps,
        options.slot,
        activeView,
        appsStatus,
      ]);
      if (key !== previousKey || appsError !== previousError) {
        previousKey = key;
        previousError = appsError;
        const slot = createSlotStore(store.client, store.contract, {
          activeView,
          apps,
          appsError,
          appsStatus,
          slot: options.slot,
        });
        query = slot;
        let last: ReturnType<typeof slot.getSnapshot> | undefined;
        let fetching: boolean | undefined;
        let snapshot: ViewsQueryResult;
        selected = createSnapshotStore(
          () => {
            const current = slot.state.get();
            const appsFetching =
              !app && store.fetch.apps.state.get().isFetching;
            if (current !== last || fetching !== appsFetching) {
              last = current;
              fetching = appsFetching;
              snapshot = result(
                { ...current, isFetching: appsFetching || current.isFetching },
                refetch
              );
            }
            return snapshot;
          },
          (listener) => {
            const stopSlot = slot.state.listen(listener);
            const stopApps = app
              ? () => {
                  /* Intentionally no action is needed. */
                }
              : store.fetch.apps.state.listen(listener);
            void slot.fetch();
            return () => {
              stopSlot();
              stopApps();
            };
          }
        );
      }
      return selected;
    }
  );
  const source = switchStore(selection);
  const state = createSnapshotStore(source.get, (listener) => {
    const stop = source.listen(listener);
    if (!app) {
      void store.fetchApps();
    }
    return stop;
  });
  return { refetch, state };
};

/** Resolve a slot reactively as discovery and registered context change. */
export const createViewsQuery = (
  store: TailorKitStore,
  options: ViewsQueryOptions
) => viewsQuery(store, options);

/** Resolve an explicitly supplied app without initiating discovery. */
export const createAppViewsQuery = (
  store: TailorKitStore,
  app: TailorKitApp,
  slot: string
) => viewsQuery(store, { slot }, app);
