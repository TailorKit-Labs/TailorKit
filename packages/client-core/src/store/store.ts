import type {
  ToolImplementations,
  PatchsmithContract,
} from "@patchsmith/core/schema";

import { createPatchsmithFetchClient } from "#client/fetch-client";
import type { PatchsmithFetchClient } from "#client/fetch-client";
import { toBaseUrl } from "#client/url";
import type { PatchsmithApp } from "#types";

import { createAppsStore } from "./fetch/apps";
import { createViewContextStore } from "./local/view-context";

export type PatchsmithStore = ReturnType<typeof createPatchsmithStore>;

/** Compose independent fetch stores and local view state for one root. */
export const createPatchsmithStore = (options: {
  baseUrl: string | URL;
  contract: PatchsmithContract;
  tools?: ToolImplementations<PatchsmithContract["tools"], "client">;
  apps?: PatchsmithApp[];
  client?: PatchsmithFetchClient;
  assetsBaseUrl?: string | URL;
}) => {
  const { baseUrl, contract, assetsBaseUrl, apps: initialApps } = options;
  const client =
    options.client ??
    createPatchsmithFetchClient({ baseUrl, contract, tools: options.tools });
  if (toBaseUrl(baseUrl).href !== toBaseUrl(client.baseUrl).href) {
    throw new Error(
      "createPatchsmithStore: baseUrl does not match the supplied fetch client."
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
