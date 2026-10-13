import { computedAsync } from "@nanostores/async";
import { atom } from "nanostores";
import type { ReadableAtom, WritableAtom } from "nanostores";

import { createSnapshotStore } from "#store/snapshot-store";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

export interface FetchCacheOptions {
  /** Milliseconds before a successful response needs refreshing. Infinity keeps it fresh. */
  staleTime?: number;
  /** Milliseconds to retain an unused response. Infinity disables eviction. */
  gcTime?: number;
}

export interface FetchSnapshot<T> {
  data: T | undefined;
  error: Error | null;
  status: "idle" | "loading" | "ready" | "error";
  isFetching: boolean;
  updatedAt: number;
}

export interface FetchOptions extends Pick<FetchCacheOptions, "staleTime"> {
  force?: boolean;
}

/** A cached request and readable state shared across framework adapters. */
export interface FetchStore<T> {
  state: ReadableAtom<FetchSnapshot<T>>;
  getSnapshot: () => FetchSnapshot<T>;
  subscribe: (listener: () => void) => () => void;
  fetch: (options?: FetchOptions) => Promise<void>;
  setData: (updater: (previous: T | undefined) => T) => void;
  invalidate: () => Promise<void>;
}

const idle = <T>(): FetchSnapshot<T> => ({
  data: undefined,
  error: null,
  isFetching: false,
  status: "idle",
  updatedAt: 0,
});

type Fetcher<T> = (signal: AbortSignal) => Promise<T>;

interface Entry {
  state: WritableAtom<FetchSnapshot<unknown>>;
  controller: AbortController | null;
  pending: Promise<void> | null;
  observers: number;
  generation: number;
  invalidated: boolean;
  gcTime: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export const serializeCacheKey = (key: readonly unknown[]): string =>
  JSON.stringify(
    key,
    // Native JSON serialization supplies arbitrary values; this boundary only normalizes object key order.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- These are serializer inputs, not unparsed domain-handler arguments.
    (_name, value: unknown) =>
      isObjectValue(value) && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).toSorted(([a], [b]) => a.localeCompare(b))
          )
        : value
  );

const duration = (value: number | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  if (value < 0 || Number.isNaN(value)) {
    throw new Error("Cache times must be non-negative.");
  }
  return value;
};

/** A cache belongs to one authenticated client, never to the process or a global singleton. */
export const createFetchCache = (defaults: FetchCacheOptions = {}) => {
  const entries = new Map<string, Entry>();
  const staleTime = duration(defaults.staleTime, 30_000);
  const gcTime = duration(defaults.gcTime, 300_000);

  const reset = (entry: Entry) => {
    entry.generation += 1;
    entry.controller?.abort();
    entry.controller = null;
    entry.pending = null;
    entry.invalidated = false;
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = null;
    entry.state.set(idle());
  };

  const scheduleGc = (key: string, entry: Entry) => {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.timer = null;
    if (entry.observers || entry.pending || entry.gcTime === Infinity) {
      return;
    }
    const expiresAt = Date.now() + entry.gcTime;
    const arm = () => {
      entry.timer = setTimeout(
        () => {
          if (entries.get(key) !== entry || entry.observers || entry.pending) {
            return;
          }
          if (Date.now() < expiresAt) {
            arm();
            return;
          }
          entries.delete(key);
          reset(entry);
        },
        Math.min(Math.max(0, expiresAt - Date.now()), 2_147_483_647)
      );
      if (isObjectValue(entry.timer)) {
        entry.timer.unref?.();
      }
    };
    arm();
  };

  return {
    clear: () => {
      for (const [key, entry] of entries) {
        reset(entry);
        if (!entry.observers) {
          entries.delete(key);
        }
      }
    },
    getStore: <T>(
      input: readonly unknown[],
      fetcher: Fetcher<T>,
      options: FetchCacheOptions & { abortOnUnsubscribe?: boolean } = {}
    ): FetchStore<T> => {
      const key = serializeCacheKey(input);
      const retention = duration(options.gcTime, gcTime);
      const freshness = duration(options.staleTime, staleTime);
      const getEntry = () => {
        let entry = entries.get(key);
        if (!entry) {
          entry = {
            controller: null,
            gcTime: retention,
            generation: 0,
            invalidated: false,
            observers: 0,
            pending: null,
            state: atom(idle<unknown>()),
            timer: null,
          };
          entries.set(key, entry);
          scheduleGc(key, entry);
        }
        if (retention > entry.gcTime) {
          entry.gcTime = retention;
          scheduleGc(key, entry);
        }
        return entry;
      };
      // SAFETY: This entry is populated by the store's T-typed fetcher and updater; the shared key table erases that generic.
      const store = {
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        fetch: (settings: FetchOptions = {}) => {
          const entry = getEntry();
          if (entry.pending && !(settings.force === true)) {
            return entry.pending;
          }
          const snapshot = entry.state.get();
          const age = Date.now() - snapshot.updatedAt;
          if (
            !(settings.force === true) &&
            !entry.invalidated &&
            snapshot.status === "ready" &&
            age < duration(settings.staleTime, freshness)
          ) {
            return Promise.resolve();
          }
          if (entry.timer) {
            clearTimeout(entry.timer);
          }
          entry.timer = null;
          entry.controller?.abort();
          const controller = new AbortController();
          entry.controller = controller;
          entry.generation += 1;
          const { generation } = entry;
          let start!: () => void;
          // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
          const pending = (() => {
            const {
              promise: pendingPromise,
              resolve,
              reject: rejectPending,
            } = Promise.withResolvers<ReturnType<() => void>>();
            try {
              start = () => {
                // Async owns fetching, settlement, and Nano Stores task tracking.
                const request = computedAsync(
                  atom(controller.signal),
                  // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
                  (signal) => {
                    signal.throwIfAborted();
                    return fetcher(signal);
                  }
                );
                const stop = request.listen((result) => {
                  if (result.state === "loading") {
                    return;
                  }
                  stop();
                  if (entry.generation === generation) {
                    if (result.state === "ready") {
                      entry.invalidated = false;
                      entry.state.set({
                        data: result.value,
                        error: null,
                        isFetching: false,
                        status: "ready",
                        updatedAt: Date.now(),
                      });
                    } else {
                      entry.state.set({
                        ...entry.state.get(),
                        error:
                          result.error instanceof Error
                            ? result.error
                            : new Error(String(result.error)),
                        isFetching: false,
                        status: "error",
                      });
                    }
                    if (entry.generation === generation) {
                      entry.controller = null;
                      entry.pending = null;
                      scheduleGc(key, entry);
                    }
                  }
                  resolve();
                });
              };
            } catch (error) {
              rejectPending(error);
            }
            return pendingPromise;
          })();
          entry.pending = pending;
          const previous = entry.state.get();
          entry.state.set({
            ...previous,
            error: null,
            isFetching: true,
            status: previous.data === undefined ? "loading" : "ready",
          });
          start();
          return pending;
        },
        getSnapshot: () =>
          /* oxlint-disable typescript/no-unsafe-type-assertion -- The public generic API establishes this relationship; its runtime registry erases the type parameters. */
          getEntry().state.get() as FetchSnapshot<T>,
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        // oxlint-disable-next-line typescript/promise-function-async -- Return the shared in-flight Promise itself; async wrappers would break request deduplication and Promise identity.
        invalidate: () => {
          const entry = getEntry();
          entry.invalidated = true;
          if (entry.observers) {
            return store.fetch({ force: true });
          }
          return Promise.resolve();
        },
        setData: (updater: (previous: T | undefined) => T) => {
          const entry = getEntry();
          entry.generation += 1;
          entry.controller?.abort();
          entry.controller = null;
          entry.pending = null;
          entry.invalidated = false;
          // SAFETY: This entry is populated by the store's T-typed fetcher and updater; the shared key table erases that generic.
          entry.state.set({
            data: updater(
              /* oxlint-disable typescript/no-unsafe-type-assertion -- This entry is populated by the store's T-typed fetcher and updater; the shared key table erases that generic. */
              entry.state.get().data as T | undefined
              /* oxlint-enable typescript/no-unsafe-type-assertion */
            ),
            error: null,
            isFetching: false,
            status: "ready",
            updatedAt: Date.now(),
          });
          scheduleGc(key, entry);
        },
        subscribe: (listener: () => void) => {
          const entry = getEntry();
          if (entry.timer) {
            clearTimeout(entry.timer);
          }
          entry.timer = null;
          entry.observers += 1;
          const unsubscribe = entry.state.listen(listener);
          let active = true;
          return () => {
            if (!active) {
              return;
            }
            active = false;
            unsubscribe();
            entry.observers -= 1;
            if (
              !entry.observers &&
              options.abortOnUnsubscribe === true &&
              entry.pending
            ) {
              entry.generation += 1;
              entry.controller?.abort();
              entry.controller = null;
              entry.pending = null;
              const previous = entry.state.get();
              entry.state.set({
                ...previous,
                isFetching: false,
                status: previous.data === undefined ? "idle" : "ready",
              });
            }
            scheduleGc(key, entry);
          };
        },
      };
      return {
        ...store,
        state: createSnapshotStore(store.getSnapshot, store.subscribe),
      };
    },
  };
};

export type FetchCache = ReturnType<typeof createFetchCache>;
