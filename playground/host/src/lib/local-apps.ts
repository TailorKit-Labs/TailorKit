import type { TailorKitApp } from "tailorkit/react";

export const localPlaygroundApps: TailorKitApp[] = [
  {
    id: "playground-todo",
    name: "Todo",
    description: "A small team checklist for the current workspace.",
    clientPath: "/api/playground/todo-client",
    views: [{ slot: "panel", path: "/" }],
  },
];
