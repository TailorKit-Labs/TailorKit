import { z } from "zod";

import { defineView } from "./index";

const root = defineView({ component: () => null, slot: "navbar", view: "/" });
// @ts-expect-error View paths must be declared by the host.
defineView({ component: () => null, slot: "panel", view: "/unknown" });

defineView({
  slot: "navbar",
  view: "/",
  component: () => null,
  // @ts-expect-error Apps cannot provide loading components for host context.
  loading: () => null,
});
defineView({
  slot: "navbar",
  view: "/",
  component: () => null,
  // @ts-expect-error Apps cannot provide error components for host context.
  error: () => null,
});

// Internal loading and error states remain valid without context.
root.component({ status: "loading", view: "/" });
root.component({ status: "error", view: "/" });
root.component({ context: { workspaceId: "w1" }, status: "ready", view: "/" });
// @ts-expect-error Non-ready states must not expose context.
root.component({
  context: { workspaceId: "w1" },
  status: "loading",
  view: "/",
});
// @ts-expect-error Non-ready states must not expose context.
root.component({ context: { workspaceId: "w1" }, status: "error", view: "/" });

// @ts-expect-error Multi-instance slots require instances in defineView.
defineView({ component: () => null, slot: "page", view: "/" });
defineView({
  slot: "panel",
  view: "/",
  component: () => null,
  // @ts-expect-error Single-instance slots reject instances.
  instances: { dataSchema: z.object({}), resolve: () => [] },
});
defineView({
  slot: "navbar",
  view: "/",
  component: () => null,
  // @ts-expect-error An omitted multiple flag also rejects instances.
  instances: { dataSchema: z.object({}), resolve: () => [] },
});
// @ts-expect-error The slot must support the view path.
defineView({ component: () => null, slot: "navbar", view: "/users" });
const slotName: "page" | "navbar" = Math.random() > 0.5 ? "page" : "navbar";
// @ts-expect-error A union slot cannot bypass the instances requirement.
defineView({ component: () => null, slot: slotName, view: "/" });
// File routes infer the slot from the containing directory.
defineView({ component: () => null, view: "/" });

// @ts-expect-error Views must select a host context path.
defineView({ component: () => null, slot: "panel" });
// @ts-expect-error The positional signature is no longer supported.
defineView("/", { component: () => null, slot: "panel" });

defineView({ component: () => null });
