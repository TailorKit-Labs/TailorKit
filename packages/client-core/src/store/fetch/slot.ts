import type { ViewInstance } from "@patchsmith/app/client";
import type { ViewsInput } from "@patchsmith/core/views";

import type { PatchsmithFetchClient } from "#client/fetch-client";
import { createSnapshotStore } from "#store/snapshot-store";
import type { PatchsmithApp } from "#types";

import type { FetchCacheOptions, FetchSnapshot } from "./cache";

export type SlotItem<TMultiple extends boolean = boolean> =
  TMultiple extends true
    ? ViewInstance & { app: PatchsmithApp }
    : { app: PatchsmithApp };

export interface SlotSnapshot {
  data: SlotItem[] | undefined;
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
}

/** All discovery, matching and instance resolution is owned by the host endpoint. */
export const createSlotStore = (
  client: PatchsmithFetchClient,
  input: ViewsInput,
  settings: FetchCacheOptions = {}
) => {
  const query = client.views(input, settings);
  let previous: ReturnType<typeof query.getSnapshot> | undefined;
  let snapshot: SlotSnapshot;

  const getSnapshot = (): SlotSnapshot => {
    const current = query.getSnapshot();

    if (current !== previous) {
      previous = current;
      snapshot = {
        data: current.data?.status === "ready" ? current.data.data : undefined,
        error: current.error,
        isFetching: current.isFetching,
        status:
          current.status === "ready"
            ? (current.data?.status ?? "idle")
            : current.status,
      };
    }

    return snapshot;
  };

  return {
    ...query,
    getSnapshot,
    state: createSnapshotStore(getSnapshot, query.subscribe),
  };
};
