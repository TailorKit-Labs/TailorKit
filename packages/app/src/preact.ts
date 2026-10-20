import { useStore } from "@nanostores/preact";
/* oxlint-disable react/immutability -- Preact refs are mutable; the React compiler rule does not recognize preact/hooks.useRef. */
import { atom, computed } from "nanostores";
import { createContext, h } from "preact";
import type { ComponentChildren } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "preact/hooks";

import { createClient } from "./client/connection";
import type { Client } from "./client/connection";
import { pendingQuery, QueryStore, serializeInput } from "./client/query-store";
import type { QueryState } from "./client/query-store";
import { reference } from "./client/reference";
import type { Reference } from "./client/reference";
import { appError } from "./errors";
import type { AppError } from "./errors";

const Context = createContext<QueryStore | null>(null);

export interface ClientProviderProps {
  children?: ComponentChildren;
  /** Supply a client for custom transport configuration. Caller-owned clients are not closed. */
  client?: Client;
  onError?: (error: AppError) => void;
}

export const ClientProvider = ({
  children,
  client,
  onError,
}: ClientProviderProps) => {
  const errorHandler = useRef(onError);
  errorHandler.current = onError;

  const store = useMemo(
    () =>
      new QueryStore(client ?? createClient(), !client, (error) =>
        errorHandler.current?.(error)
      ),
    [client]
  );

  useLayoutEffect(
    () => () => {
      store.dispose();
    },
    [store]
  );

  return h(Context.Provider, { value: store }, children);
};

const useQueryStore = () => {
  const store = useContext(Context);

  if (!store) {
    throw new Error(
      "Patchsmith backend hooks require a ClientProvider at the app root."
    );
  }

  return store;
};

export interface QueryOptions {
  enabled?: boolean;
}

type InputArguments<I> = undefined extends I ? [input?: I] : [input: I];

type QueryArguments<I> = undefined extends I
  ? [input?: I, options?: QueryOptions]
  : [input: I, options?: QueryOptions];

export interface QueryResult<T> extends QueryState<T> {
  isPending: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  isError: boolean;
}

export const useQuery = <I, O>(
  ref: Reference<"query", I, O>,
  ...[input, options]: QueryArguments<NoInfer<I>>
): QueryResult<O> => {
  const store = useQueryStore();
  const enabled = options?.enabled ?? true;
  const { name } = ref;
  const serialized = serializeInput(input);
  const key = `${name}\0${serialized}`;

  // SAFETY: serializeInput produced serialized from this reference's own input; this parses local transport-normalized input rather than external JSON.
  const stableInput = useMemo(
    () =>
      /* oxlint-disable typescript/no-unsafe-type-assertion -- serializeInput produced serialized from this reference's own input; this parses local transport-normalized input rather than external JSON. */
      (JSON.parse(serialized) as { input: I })
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        .input,
    [serialized]
  );

  const stableReference = useMemo(
    () => reference<"query", I, O>(name, "query"),
    [name]
  );

  // SAFETY: This cache key identifies the same reference and serialized input, so its state is populated only by that reference's O-typed subscription.
  const query = useMemo(
    () =>
      computed(
        store.state,
        (queries) =>
          /* oxlint-disable typescript/no-unsafe-type-assertion -- This cache key identifies the same reference and serialized input, so its state is populated only by that reference's O-typed subscription. */
          (enabled
            ? (queries.get(key) ?? pendingQuery)
            : pendingQuery) as QueryState<O>
        /* oxlint-enable typescript/no-unsafe-type-assertion */
      ),
    [store, key, enabled]
  );

  const state = useStore(query);
  useEffect(
    () =>
      enabled ? store.watch(key, stableReference, stableInput) : undefined,
    [store, key, enabled, stableInput, stableReference]
  );

  return {
    ...state,
    isError: state.status === "error",
    isLoading: enabled && state.status === "pending",
    isPending: state.status === "pending",
    isSuccess: state.status === "success",
  };
};

export interface CallOptions<I, O> {
  onSuccess?: (data: O, input: I) => void;
  onError?: (error: AppError, input: I) => void;
}

export interface CallState<T> {
  data: T | undefined;
  error: AppError | null;
  status: "idle" | "pending" | "success" | "error";
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  reset: () => void;
}

const idleCall = { data: undefined, error: null, status: "idle" as const };

const useCall = <K extends "mutation" | "action", I, O>(
  kind: K,
  ref: Reference<K, I, O>,
  options: CallOptions<I, O>
) => {
  const store = useQueryStore();
  const { name } = ref;

  const identity = useMemo(
    () => ({
      kind,
      name,
      state: atom<Pick<CallState<O>, "data" | "error" | "status">>(idleCall),
      store,
    }),
    [store, name, kind]
  );

  const state = useStore(identity.state);
  const current = useRef({ identity, mounted: true, sequence: 0 });

  if (current.current.identity !== identity) {
    current.current = {
      identity,
      mounted: true,
      sequence: current.current.sequence + 1,
    };
  }

  const callbacks = useRef(options);
  callbacks.current = options;
  // Preact 11 defers passive cleanup; invalidate pending calls during unmount itself.
  useLayoutEffect(() => {
    current.current.mounted = true;

    return () => {
      current.current.mounted = false;
      current.current.sequence += 1;
    };
  }, []);

  const runAsync = useCallback(
    async (...[input]: InputArguments<I>): Promise<O> => {
      current.current.sequence += 1;
      const { sequence } = current.current;
      const settings = callbacks.current;

      // SAFETY: InputArguments requires an I value unless I includes undefined; destructuring its conditional tuple loses that relationship.
      const args =
        /* oxlint-disable typescript/no-unsafe-type-assertion -- InputArguments requires an I value unless I includes undefined; destructuring its conditional tuple loses that relationship. */
        input as I;

      /* oxlint-enable typescript/no-unsafe-type-assertion */
      const isCurrent = () =>
        current.current.mounted &&
        current.current.identity === identity &&
        current.current.sequence === sequence;

      identity.state.set({ ...idleCall, status: "pending" });
      let data: O;

      try {
        data =
          kind === "mutation"
            ? await store.client.mutate(
                reference<"mutation", I, O>(name, "mutation"),
                args
              )
            : await store.client.action(
                reference<"action", I, O>(name, "action"),
                args
              );
      } catch (error) {
        const failure = appError(error);

        if (isCurrent()) {
          identity.state.set({
            data: undefined,
            error: failure,
            status: "error",
          });
          settings.onError?.(failure, args);
        }

        store.onError(failure);
        throw failure;
      }

      if (isCurrent()) {
        identity.state.set({ data, error: null, status: "success" });
        settings.onSuccess?.(data, args);
      }

      return data;
    },
    [identity, kind, store, name]
  );

  const run = useCallback(
    (...args: InputArguments<I>) => {
      void (async () => {
        try {
          await runAsync(...args);
        } catch {
          /* Intentionally no action is needed. */
        }
      })();
    },
    [runAsync]
  );

  const reset = useCallback(() => {
    current.current.sequence += 1;
    identity.state.set(idleCall);
  }, [identity]);

  return {
    ...state,
    isError: state.status === "error",
    isPending: state.status === "pending",
    isSuccess: state.status === "success",
    reset,
    run,
    runAsync,
  };
};

export interface MutationResult<I, O> extends CallState<O> {
  mutate: (...args: InputArguments<I>) => void;
  mutateAsync: (...args: InputArguments<I>) => Promise<O>;
}

export const useMutation = <I, O>(
  ref: Reference<"mutation", I, O>,
  options: CallOptions<I, O> = {}
): MutationResult<I, O> => {
  const { run, runAsync, ...state } = useCall("mutation", ref, options);

  return { ...state, mutate: run, mutateAsync: runAsync };
};

export interface ActionResult<I, O> extends CallState<O> {
  execute: (...args: InputArguments<I>) => void;
  executeAsync: (...args: InputArguments<I>) => Promise<O>;
}

export const useAction = <I, O>(
  ref: Reference<"action", I, O>,
  options: CallOptions<I, O> = {}
): ActionResult<I, O> => {
  const { run, runAsync, ...state } = useCall("action", ref, options);

  return { ...state, execute: run, executeAsync: runAsync };
};
