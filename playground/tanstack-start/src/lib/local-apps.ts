import type { PatchSmithApp } from "patchsmith/react";

export const localPlaygroundApps: PatchSmithApp[] = [
  {
    clientPath: "/api/playground/todo-client",
    description: "A small team checklist for the current workspace.",
    id: "playground-todo",
    name: "Todo",
    views: [{ path: "/", slot: "panel" }],
  },
];
