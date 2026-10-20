import type { PatchsmithContract } from "@patchsmith/core/schema";
import { getViewDepth, isViewAncestor } from "@patchsmith/core/views";
import type { ActiveView, ViewStatus } from "@patchsmith/core/views";
import { atom } from "nanostores";

import { validateViewContext } from "./view-context-diagnostics";
import type { ViewContextResult } from "./view-context-diagnostics";
import type { ViewContextRegistration } from "./view-context-types";

export interface ViewEntry {
  id: symbol;
  view: string;
  context: unknown;
  status: ViewStatus;
  order: number;
}

/** Own view state and diagnostics independently of any framework adapter. */
export const createViewContextStore = (
  contract: Pick<PatchsmithContract, "views">
) => {
  const entries = new Map<symbol, ViewEntry>();

  const state = atom<ActiveView | null>(null);

  let nextOrder = 0;

  let scheduled = false;

  const keys = new Map<symbol, string>();

  const diagnostics = new Map<symbol, string>();

  const parsed = new Map<symbol, { context: unknown; status: ViewStatus }>();

  const publish = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    // Registrations and cleanups in the same turn settle before publication.
    queueMicrotask(() => {
      scheduled = false;

      // Retain diagnostic keys across synchronous cleanup/remount cycles.
      for (const id of diagnostics.keys()) {
        if (!entries.has(id)) {
          diagnostics.delete(id);
        }
      }

      const ordered = [...entries.values()].toSorted(
        (a, b) =>
          getViewDepth(b.view) - getViewDepth(a.view) || b.order - a.order
      );

      const [selected] = ordered;

      if (selected) {
        const peers = ordered.filter(
          (entry) => getViewDepth(entry.view) === getViewDepth(selected.view)
        );

        if (peers.length > 1) {
          console.warn(
            `Patchsmith found multiple active views at the same hierarchy depth: ${peers
              .toReversed()
              .map((entry) => `"${entry.view}"`)
              .join(
                ", "
              )}. Patchsmith selected "${selected.view}" by mount order. Only one route at a hierarchy depth should register a view.`
          );
        }

        state.set({
          layers: ordered
            .filter((entry) => isViewAncestor(entry.view, selected.view))
            .toReversed()
            .map((entry) => ({
              context: parsed.get(entry.id)?.context,
              path: entry.view,
              status: parsed.get(entry.id)?.status ?? entry.status,
            })),
          view: selected.view,
        });
      } else {
        state.set(null);
      }
    });
  };

  const apply = (entry: ViewEntry, result: ViewContextResult) => {
    if (entries.get(entry.id) !== entry) {
      return;
    }

    if ("value" in result) {
      parsed.set(entry.id, { context: result.value, status: entry.status });
      diagnostics.delete(entry.id);
    } else {
      parsed.set(entry.id, { context: undefined, status: "error" });
      const key = JSON.stringify([entry.view, entry.context, result.message]);

      if (key !== diagnostics.get(entry.id)) {
        diagnostics.set(entry.id, key);

        if (result.details === undefined) {
          console.error(result.message);
        } else {
          console.error(result.message, result.details);
        }
      }
    }

    publish();
  };

  const check = (entry: ViewEntry) => {
    const failed = (cause: unknown) => {
      apply(entry, {
        details: cause,
        message: `Patchsmith could not validate context for view "${entry.view}".`,
      });
    };

    try {
      // SAFETY: The requested view name was resolved against this contract; indexing its declared view table preserves the associated validator.
      const result = validateViewContext(
        entry,
        contract.views[
          /* oxlint-disable typescript/no-unsafe-type-assertion -- The requested view name was resolved against this contract; indexing its declared view table preserves the associated validator. */
          entry.view as keyof typeof contract.views
          /* oxlint-enable typescript/no-unsafe-type-assertion */
        ]
      );

      if ("then" in result) {
        parsed.set(entry.id, { context: undefined, status: "loading" });
        void (async () => {
          let value;

          try {
            value = await result;
          } catch (error) {
            failed(error);

            return;
          }

          apply(entry, value);
        })();
      } else {
        apply(entry, result);
      }
    } catch (error) {
      failed(error);
    }
  };

  return {
    getSnapshot: () => state.get(),
    register: (input: ViewContextRegistration) => {
      const status = (() => {
        if (
          input.error !== null &&
          input.error !== undefined &&
          input.error !== false
        ) {
          return "error" as const;
        }

        if (input.loading === true) {
          return "loading" as const;
        }

        return "ready" as const;
      })();

      const context = status === "ready" ? input.context : undefined;
      const key = JSON.stringify({ context, status, view: input.view });

      if (keys.get(input.id) === key) {
        return;
      }

      const entry: ViewEntry = {
        context,
        id: input.id,
        order: entries.get(input.id)?.order ?? (nextOrder += 1) - 1,
        status,
        view: input.view,
      };

      entries.set(input.id, entry);
      keys.set(input.id, key);
      check(entry);
      publish();
    },
    state,
    subscribe: (listener: () => void): (() => void) => state.listen(listener),
    unregister: (id: symbol) => {
      if (!entries.delete(id)) {
        return;
      }

      keys.delete(id);
      parsed.delete(id);
      publish();
    },
  };
};
