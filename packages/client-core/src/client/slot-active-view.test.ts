import { defineContract } from "@patchsmith/core/schema";
import type { ActiveView } from "@patchsmith/core/views";
import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { slotActiveView } from "./slot-active-view";

const context = z.object({});

const contract = defineContract({
  slots: {
    details: { multiple: true, views: ["/", "/contacts"] },
    page: { multiple: true, views: ["/"] },
    single: { views: ["/"] },
  },
  views: { "/": context, "/contacts": context, "/contacts/detail": context },
});

const active: ActiveView = {
  layers: [
    {
      context: { page: "/contacts/123", workspace: "one" },
      path: "/",
      status: "ready",
    },
    { path: "/contacts", status: "loading" },
    { path: "/contacts/detail", status: "error" },
  ],
  view: "/contacts/detail",
};

it("retains all ancestors of the deepest supported view, including unavailable context", () => {
  expect(slotActiveView(contract, "details", active)).toEqual({
    layers: active.layers.slice(0, 2),
    view: "/contacts",
  });
  expect(slotActiveView(contract, "page", active)).toEqual({
    layers: active.layers.slice(0, 1),
    view: "/",
  });
});

it("preserves unmatched input and idle/single-slot behavior", () => {
  const unmatched = { ...active, view: "/other" };
  expect(
    slotActiveView(
      { slots: { details: contract.slots.details } },
      "details",
      unmatched
    )
  ).toEqual({
    layers: active.layers.slice(0, 1),
    view: "/",
  });
  expect(
    slotActiveView(
      { slots: { page: { multiple: true, views: ["/settings"] } } },
      "page",
      active
    )
  ).toBe(active);
  expect(slotActiveView(contract, "page", null)).toBeNull();
  expect(slotActiveView(contract, "single", active)).toBeNull();
});
