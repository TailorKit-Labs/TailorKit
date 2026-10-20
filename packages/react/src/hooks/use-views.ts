import { createValueMemo, createViewsQuery } from "@patchsmith/client-core";
import type { SlotItem, ViewsQueryOptions } from "@patchsmith/client-core";
import { useMemo } from "react";

import { usePatchsmithContext } from "#components/context";

import { useQueryResult } from "./use-query-result";
import type { UseQueryResult } from "./use-query-result";

export type { SlotItem } from "@patchsmith/client-core";

export type UseViewsOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> = ViewsQueryOptions<TScopeNames, TSlot>;

export type UseViewsResult<TMultiple extends boolean = boolean> =
  UseQueryResult<SlotItem<TMultiple>[]>;

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

  return useQueryResult(query.state);
};
