import type { ViewName, ViewState } from "@patchsmith/client-core";
import type { ViewDefinition } from "@patchsmith/core/schema";
import { useEffect, useMemo } from "react";

import { usePatchSmithContext } from "#components/context";

export type {
  ViewName,
  ViewContext,
  ViewContextInput,
  ViewOptions,
  ViewState,
} from "@patchsmith/client-core";

type DefaultViews = Record<`/${string}`, ViewDefinition>;

export type UseViewContext<TViews extends Record<string, ViewDefinition>> = <
  TView extends ViewName<TViews>,
>(
  view: TView,
  options: ViewState<TViews, NoInfer<TView>>
) => void;

export const useViewContext = <
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TView extends ViewName<TViews> = ViewName<TViews>,
>(
  view: TView,
  options: ViewState<TViews, NoInfer<TView>>
): void => {
  const { store } = usePatchSmithContext("useViewContext");
  const id = useMemo(() => Symbol("patchsmith-current-view"), []);
  const { context, loading, error } = options;

  useEffect(
    () => () => {
      store.views.unregister(id);
    },
    [id, store]
  );

  useEffect(() => {
    store.views.register({ context, error, id, loading, view });
  }, [id, view, context, loading, error, store]);
};
