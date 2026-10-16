import { atom } from "nanostores";

import type { TailorKitFetchClient } from "#client/fetch-client";
import { createSnapshotStore } from "#store/snapshot-store";
import type { TailorKitApp } from "#types";

import type { FetchOptions, FetchSnapshot } from "./cache";

export interface TailorKitAppsSnapshot {
  apps: TailorKitApp[];
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
}

const suppliedSnapshotImplementation = (
  apps: TailorKitApp[]
): TailorKitAppsSnapshot => ({
  apps,
  error: null,
  isFetching: false,
  status: "ready",
});

export const createAppsStore = (
  client: TailorKitFetchClient,
  initialApps?: TailorKitApp[]
) => {
  const query = client.apps();
  const provided = atom(initialApps);
  const suppliedSnapshot = suppliedSnapshotImplementation;
  let supplied =
    initialApps === undefined ? null : suppliedSnapshot(initialApps);
  let last: FetchSnapshot<TailorKitApp[]> | undefined;
  let snapshot: TailorKitAppsSnapshot;
  let requested = false;
  let subscribers = 0;
  const empty: TailorKitApp[] = [];
  const store = {
    // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
    fetch: (options: FetchOptions = {}) => {
      requested = true;
      if (supplied) {
        return Promise.resolve();
      }
      return query.fetch(options);
    },
    getSnapshot: (): TailorKitAppsSnapshot => {
      if (supplied) {
        return supplied;
      }
      const current = query.getSnapshot();
      if (current !== last) {
        const apps = current.data ?? empty;
        snapshot = {
          apps,
          error: current.error,
          isFetching: current.isFetching,
          status: current.status,
        };
        last = current;
      }
      return snapshot;
    },
    // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
    invalidate: () => {
      if (supplied) {
        return Promise.resolve();
      }
      return query.invalidate();
    },
    setProvidedApps: (apps: TailorKitApp[] | undefined) => {
      if (provided.get() === apps) {
        return;
      }
      supplied = apps === undefined ? null : suppliedSnapshot(apps);
      provided.set(apps);
      if (!supplied && requested && subscribers) {
        void store.fetch({ force: true });
      }
    },
    subscribe: (listener: () => void) => {
      subscribers += 1;
      const stopProvided = provided.listen(listener);
      const stopQuery = query.subscribe(() => {
        if (!supplied) {
          listener();
        }
      });
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        stopProvided();
        stopQuery();
        subscribers -= 1;
      };
    },
  };
  return {
    ...store,
    state: createSnapshotStore(store.getSnapshot, store.subscribe),
  };
};
