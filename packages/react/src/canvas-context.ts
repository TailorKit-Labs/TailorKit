import type { RemoteViewStore } from "@patchsmith/client-core";
import type { experimental_CanvasPolicy } from "@patchsmith/core/schema";
import { createContext } from "react";

export const CanvasPoliciesContext = createContext<
  Record<string, experimental_CanvasPolicy>
>({});

export const CanvasNodeContext = createContext<{
  store: RemoteViewStore;
  nodeId: string;
  policy?: experimental_CanvasPolicy;
} | null>(null);
