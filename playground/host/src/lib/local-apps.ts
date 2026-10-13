import type { TailorKitApp } from "tailorkit/react";

export const localPlaygroundApps: TailorKitApp[] = [
  {
    clientPath: "/api/playground/todo-client",
    description: "A small team checklist for the current workspace.",
    id: "playground-todo",
    name: "Todo",
    views: [{ slot: "panel", path: "/" }],
  },
];
