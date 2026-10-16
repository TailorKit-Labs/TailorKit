import type {
  ToolImplementations,
  TailorKitContract,
} from "@tailorkit/core/schema";

import { createTailorKitFetchClient } from "#client/fetch-client";
import type { TailorKitFetchClient } from "#client/fetch-client";
import { toBaseUrl } from "#client/url";
import type { TailorKitApp } from "#types";

import { createAppsStore } from "./fetch/apps";
import { createViewContextStore } from "./local/view-context";

export type TailorKitStore = ReturnType<typeof createTailorKitStore>;

/** Compose independent fetch stores and local view state for one root. */
export const createTailorKitStore = (options: {
  baseUrl: string | URL;
  contract: TailorKitContract;
  tools?: ToolImplementations<TailorKitContract["tools"], "client">;
  apps?: TailorKitApp[];
  client?: TailorKitFetchClient;
  assetsBaseUrl?: string | URL;
}) => {
  const { baseUrl, contract, assetsBaseUrl, apps: initialApps } = options;
  const client =
    options.client ??
    createTailorKitFetchClient({ baseUrl, contract, tools: options.tools });
  if (toBaseUrl(baseUrl).href !== toBaseUrl(client.baseUrl).href) {
    throw new Error(
      "createTailorKitStore: baseUrl does not match the supplied fetch client."
    );
  }
  const apps = createAppsStore(client, initialApps);
  return {
    assetsBaseUrl,
    baseUrl: client.baseUrl,
    client,
    contract,
    fetch: { apps },
    fetchApps: apps.fetch,
    getAppsSnapshot: apps.getSnapshot,
    setProvidedApps: apps.setProvidedApps,
    subscribeApps: apps.subscribe,
    views: createViewContextStore(contract),
  };
};
