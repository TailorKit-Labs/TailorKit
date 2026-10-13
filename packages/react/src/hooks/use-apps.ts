import { createValueMemo, createAppsQuery } from "@tailorkit/client-core";
import type {
  AppsQueryOptions,
  TailorKitApp,
  TailorKitStore,
} from "@tailorkit/client-core";
import { useMemo } from "react";

import { useTailorkitContext } from "#components/context";

import { useQueryResult } from "./use-query-result";
import type { UseQueryResult } from "./use-query-result";

export type UseAppsOptions<TScopeNames extends string = string> =
  AppsQueryOptions<TScopeNames>;

export type UseAppsResult = UseQueryResult<TailorKitApp[]>;

export const useAppsStore = (
  store: TailorKitStore,
  options: UseAppsOptions = {}
): UseAppsResult => {
  const memoOptions = useMemo(() => createValueMemo<AppsQueryOptions>(), []);
  const stableOptions = memoOptions({
    appIds:
      options.appIds === undefined
        ? undefined
        : [...new Set(options.appIds)].toSorted(),
    scopes:
      options.scopes === undefined
        ? undefined
        : [...new Set(options.scopes)].toSorted(),
  });
  const query = useMemo(
    () => createAppsQuery(store, stableOptions),
    [store, stableOptions]
  );
  return useQueryResult(query.state);
};

export const useApps = (options: UseAppsOptions = {}): UseAppsResult =>
  useAppsStore(useTailorkitContext("useApps").store, options);
