import type { PatchsmithStore } from "@patchsmith/client-core";
import { createContext, useContext } from "react";

import type { PatchsmithClientConfig } from "#patchsmith";

export interface PatchsmithContextValue {
  store: PatchsmithStore;
  client: PatchsmithClientConfig;
}

export const PatchsmithContext = createContext<PatchsmithContextValue | null>(
  null
);

export const usePatchsmithContext = (
  component: string,
  expectedClient?: PatchsmithClientConfig
): PatchsmithContextValue => {
  const context = useContext(PatchsmithContext);
  if (!context) {
    throw new Error(
      `${component} must be rendered inside a Patchsmith Provider.`
    );
  }
  if (expectedClient && context.client !== expectedClient) {
    throw new Error(
      `${component} was created for a different Patchsmith client than the surrounding Provider.`
    );
  }
  return context;
};
