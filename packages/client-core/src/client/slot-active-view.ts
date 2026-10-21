import type { PatchsmithContract } from "@patchsmith/core/schema";
import { getViewHierarchy, isViewAncestor } from "@patchsmith/core/views";
import type { ActiveView } from "@patchsmith/core/views";

/** Only supported views and their ancestors can affect this slot's resolvers. */
export const slotActiveView = (
  contract: Pick<PatchsmithContract, "slots">,
  slot: string,
  active: ActiveView | null
): ActiveView | null => {
  const definition = contract.slots[slot];

  if (definition?.multiple !== true || active === null) {
    return null;
  }

  const view = getViewHierarchy(active.view).find((path) =>
    definition.views.includes(path)
  );

  if (view === undefined || view === active.view) {
    return active;
  }

  return {
    layers: active.layers.filter((layer) => isViewAncestor(layer.path, view)),
    view,
  };
};
