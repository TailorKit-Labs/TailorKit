import { atom } from "nanostores";

import type { TailorKitFetchClient } from "../../client/fetch-client";
import type { TailorKitApp } from "../../types";
import { createSnapshotStore } from "../snapshot-store";
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
    fetch(options: FetchOptions = {}) {
      requested = true;
      return supplied ? Promise.resolve() : query.fetch(options);
    },
    getSnapshot(): TailorKitAppsSnapshot {
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
    invalidate: () => (supplied ? Promise.resolve() : query.invalidate()),
    refresh() {
      return requested ? store.fetch({ force: true }) : Promise.resolve();
    },
    setProvidedApps(apps: TailorKitApp[] | undefined) {
      if (provided.get() === apps) {
        return;
      }
      supplied = apps === undefined ? null : suppliedSnapshot(apps);
      provided.set(apps);
      if (!supplied && requested && subscribers) {
        void store.fetch({ force: true });
      }
    },
    subscribe(listener: () => void) {
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
    updateViews(appId: string, appViews: NonNullable<TailorKitApp["views"]>) {
      const update = (apps: TailorKitApp[]) =>
        apps.map((app) =>
          app.id === appId ? { ...app, views: appViews } : app
        );
      if (supplied) {
        store.setProvidedApps(update(supplied.apps));
      } else {
        const apps = query.getSnapshot().data;
        if (apps?.some((app) => app.id === appId)) {
          query.setData(() => update(apps));
        }
      }
    },
  };
  return {
    ...store,
    state: createSnapshotStore(store.getSnapshot, store.subscribe),
  };
};
