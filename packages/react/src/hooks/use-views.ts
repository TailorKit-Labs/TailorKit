import { useStore } from "@nanostores/react";
import { createValueMemo, createViewsQuery } from "@patchsmith/client-core";
import type {
  SlotItem,
  ViewResolutionWarning,
  ViewsQueryOptions,
} from "@patchsmith/client-core";
import { useMemo } from "react";

import { usePatchsmithContext } from "#components/context";

import type { UseQueryResult } from "./use-query-result";

export type { SlotItem, ViewResolutionWarning } from "@patchsmith/client-core";

export type UseViewsOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> = ViewsQueryOptions<TScopeNames, TSlot>;

export type UseViewsResult<TMultiple extends boolean = boolean> =
  UseQueryResult<SlotItem<TMultiple>[]> & {
    /** Non-fatal issues for apps omitted from the resolved data. Empty for complete results. */
    warnings: ViewResolutionWarning[];
  };

/** Subscribe to the shared views query using React's lifecycle. */
export const useViews = (options: UseViewsOptions): UseViewsResult => {
  const { store } = usePatchsmithContext("useViews");
  const memoOptions = useMemo(() => createValueMemo<UseViewsOptions>(), []);

  const stableOptions = memoOptions({
    appIds:
      options.appIds === undefined
        ? undefined
        : [...new Set(options.appIds)].toSorted(),
    scopes:
      options.scopes === undefined
        ? undefined
        : [...new Set(options.scopes)].toSorted(),
    slot: options.slot,
  });

  const query = useMemo(
    () => createViewsQuery(store, stableOptions),
    [store, stableOptions]
  );

  const result = useStore(query.state);

  return useMemo(
    () => ({
      data: result.data,
      error: result.error,
      fetch: result.refetch,
      isPending: result.isPending,
      isRefetching: result.isFetching && !result.isPending,
      warnings: result.warnings,
    }),
    [result]
  );
};
