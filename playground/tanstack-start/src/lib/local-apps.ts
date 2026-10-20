import type { PatchsmithApp } from "patchsmith/react";

export const localPlaygroundApps: PatchsmithApp[] = [
  {
    clientPath: "/api/playground/todo-client",
    description: "A small team checklist for the current workspace.",
    id: "playground-todo",
    name: "Todo",
    views: [{ path: "/", slot: "panel" }],
  },
];
