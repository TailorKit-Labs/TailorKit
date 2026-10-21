import { createSlotStore } from "#store/fetch/slot";
import type { PatchsmithStore } from "#store/store";

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
    activeView:
      store.contract.slots[options.slot]?.multiple === true
        ? store.views.getSnapshot()
        : null,
  }).fetch({ force: true });
};
