import type { PatchSmithStore } from "@patchsmith/client-core";
import { createContext, useContext } from "react";

import type { PatchSmithClientConfig } from "#patchsmith";

export interface PatchSmithContextValue {
  store: PatchSmithStore;
  client: PatchSmithClientConfig;
}

export const PatchSmithContext = createContext<PatchSmithContextValue | null>(
  null
);

export const usePatchSmithContext = (
  component: string,
  expectedClient?: PatchSmithClientConfig
): PatchSmithContextValue => {
  const context = useContext(PatchSmithContext);
  if (!context) {
    throw new Error(
      `${component} must be rendered inside a PatchSmith Provider.`
    );
  }
  if (expectedClient && context.client !== expectedClient) {
    throw new Error(
      `${component} was created for a different PatchSmith client than the surrounding Provider.`
    );
  }
  return context;
};
