import type {
  ToolImplementations,
  PatchSmithContract,
} from "@patchsmith/core/schema";

import { createPatchSmithFetchClient } from "#client/fetch-client";
import type { PatchSmithFetchClient } from "#client/fetch-client";
import { toBaseUrl } from "#client/url";
import type { PatchSmithApp } from "#types";

import { createAppsStore } from "./fetch/apps";
import { createViewContextStore } from "./local/view-context";

export type PatchSmithStore = ReturnType<typeof createPatchSmithStore>;

/** Compose independent fetch stores and local view state for one root. */
export const createPatchSmithStore = (options: {
  baseUrl: string | URL;
  contract: PatchSmithContract;
  tools?: ToolImplementations<PatchSmithContract["tools"], "client">;
  apps?: PatchSmithApp[];
  client?: PatchSmithFetchClient;
  assetsBaseUrl?: string | URL;
}) => {
  const { baseUrl, contract, assetsBaseUrl, apps: initialApps } = options;
  const client =
    options.client ??
    createPatchSmithFetchClient({ baseUrl, contract, tools: options.tools });
  if (toBaseUrl(baseUrl).href !== toBaseUrl(client.baseUrl).href) {
    throw new Error(
      "createPatchSmithStore: baseUrl does not match the supplied fetch client."
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
