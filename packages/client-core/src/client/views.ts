import { createSlotStore } from "#store/fetch/slot";
import type { PatchsmithStore } from "#store/store";

import { slotActiveView } from "./slot-active-view";

export interface ViewsQueryOptions<
  TScopeNames extends string = string,
  TSlot extends string = string,
> {
  slot: TSlot;
  scopes?: readonly TScopeNames[];
  appIds?: readonly string[];
}

/** Refresh discovery and instances together through the host endpoint. */
export const refetchViews = async (
  store: PatchsmithStore,
  options: ViewsQueryOptions
): Promise<void> => {
  await createSlotStore(store.client, {
    ...options,
    activeView: slotActiveView(
      store.contract,
      options.slot,
      store.views.getSnapshot()
    ),
  }).fetch({ force: true });
};
