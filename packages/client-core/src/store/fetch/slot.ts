import type { ViewInstance } from "@patchsmith/app/client";
import type { PatchsmithContract } from "@patchsmith/core/schema";
import type { ActiveView } from "@patchsmith/core/views";

import type { PatchsmithFetchClient } from "#client/fetch-client";
import { resolveSlotView } from "#client/slot-view";
import { createSnapshotStore } from "#store/snapshot-store";
import type { PatchsmithApp } from "#types";

import type { FetchCacheOptions, FetchOptions, FetchSnapshot } from "./cache";

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const contractIds = new WeakMap<PatchsmithContract, number>();
let nextContractId = 0;

interface SingleSlotItem {
  app: PatchsmithApp;
}

export type SlotItem<TMultiple extends boolean = boolean> =
  TMultiple extends true
    ? ViewInstance & { app: PatchsmithApp }
    : SingleSlotItem;

export interface SlotStoreOptions extends FetchCacheOptions {
  apps: PatchsmithApp[];
  slot: string;
  activeView: ActiveView | null;
  appsStatus?: FetchSnapshot<unknown>["status"];
  appsError?: Error | null;
}

export interface SlotSnapshot {
  data: SlotItem[] | undefined;
  error: Error | null;
  status: FetchSnapshot<unknown>["status"];
  isFetching: boolean;
}

interface Result {
  status: "idle" | "ready" | "loading";
  data?: SlotItem[];
}

/** Match all app contexts before authorizing any app or sending instance requests. */
export const createSlotStore = (
  client: PatchsmithFetchClient,
  contract: PatchsmithContract,
  options: SlotStoreOptions
) => {
  const {
    apps,
    slot,
    activeView,
    staleTime,
    gcTime,
    appsStatus = "ready",
    appsError = null,
  } = options;
  let contractId = contractIds.get(contract);
  if (contractId === undefined) {
    contractId = (nextContractId += 1) - 1;
    contractIds.set(contract, contractId);
  }
  const enabled = appsStatus === "ready";
  const settings: FetchCacheOptions = {};
  if (staleTime !== undefined) {
    settings.staleTime = staleTime;
  }
  if (gcTime !== undefined) {
    settings.gcTime = gcTime;
  }
  const waiting: SlotSnapshot = {
    data: undefined,
    error: appsStatus === "error" ? appsError : null,
    isFetching: false,
    status: appsStatus,
  };
  const query = client.cache.getStore<Result>(
    [
      "patchsmith",
      client.baseUrl.toString(),
      "slot",
      contractId,
      apps,
      slot,
      activeView,
    ],
    async (signal) => {
      const candidates = apps.filter(
        (app) =>
          app.views?.some((view) => view.slot === slot && !view.disabled) ===
          true
      );
      if (!candidates.length) {
        return { data: [], status: "ready" };
      }
      const schema = contract;
      const definition = schema.slots[slot];
      if (!definition) {
        return { data: [], status: "ready" };
      }
      if (definition.multiple !== true) {
        return {
          data: candidates
            .filter(
              (app) =>
                app.views?.some(
                  (view) =>
                    view.slot === slot &&
                    !view.disabled &&
                    !view.instances &&
                    definition.views.includes(view.path)
                ) === true
            )
            .map((app) => ({ app })),
          status: "ready",
        };
      }
      if (activeView === null) {
        return { status: "idle" };
      }
      const matches = candidates.flatMap((app) => {
        const resolved = resolveSlotView(
          app.views ?? [],
          slot,
          activeView,
          schema
        );
        return resolved?.instances === true ? [{ app, resolved }] : [];
      });
      for (const { resolved } of matches) {
        if (resolved.status === "error") {
          throw new Error(
            `Context for view "${resolved.view}" is unavailable.`
          );
        }
      }
      if (matches.some(({ resolved }) => resolved.status !== "ready")) {
        return { status: "loading" };
      }
      const controller = new AbortController();
      const abort = () => {
        controller.abort();
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        const results = await Promise.all(
          matches.map(async ({ app, resolved }) => {
            if (resolved.status !== "ready") {
              return [];
            }
            const data = await client.endpoints.slotInstances(
              app,
              { context: resolved.context, path: resolved.view, slot },
              controller.signal
            );
            return data.map((instance) => ({ ...instance, app }));
          })
        );
        return { data: results.flat(), status: "ready" };
      } catch (error) {
        controller.abort();
        throw error;
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
    { ...client.cacheOptions?.slot, ...settings, abortOnUnsubscribe: true }
  );
  let last: FetchSnapshot<Result> | undefined;
  let snapshot: SlotSnapshot;
  const store = {
    // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
    fetch: (fetchOptions: FetchOptions = {}) => {
      if (enabled) {
        return query.fetch(fetchOptions);
      }
      return Promise.resolve();
    },
    getSnapshot: (): SlotSnapshot => {
      if (!enabled) {
        return waiting;
      }
      const current = query.getSnapshot();
      if (current !== last) {
        snapshot = {
          data: current.data?.data,
          error: current.error,
          isFetching: current.isFetching,
          status:
            current.status === "ready"
              ? require(current.data).status
              : current.status,
        };
        last = current;
      }
      return snapshot;
    },
    // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
    invalidate: () => {
      if (enabled) {
        return query.invalidate();
      }
      return Promise.resolve();
    },
    subscribe: (listener: () => void) =>
      enabled
        ? query.subscribe(listener)
        : () => {
            /* Intentionally no action is needed. */
          },
  };
  return {
    ...store,
    state: createSnapshotStore(store.getSnapshot, store.subscribe),
  };
};
