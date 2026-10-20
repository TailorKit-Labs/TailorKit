import { createValueMemo, createAppsQuery } from "@patchsmith/client-core";
import type {
  AppsQueryOptions,
  PatchsmithApp,
  PatchsmithStore,
} from "@patchsmith/client-core";
import { useMemo } from "react";

import { usePatchsmithContext } from "#components/context";

import { useQueryResult } from "./use-query-result";
import type { UseQueryResult } from "./use-query-result";

export type UseAppsOptions<TScopeNames extends string = string> =
  AppsQueryOptions<TScopeNames>;

export type UseAppsResult = UseQueryResult<PatchsmithApp[]>;

export const useAppsStore = (
  store: PatchsmithStore,
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
  useAppsStore(usePatchsmithContext("useApps").store, options);
