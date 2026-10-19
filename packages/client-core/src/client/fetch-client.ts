import type {
  PatchSmithContract,
  ToolImplementations,
} from "@patchsmith/core/schema";

import { createFetchCache } from "#store/fetch/cache";
import type { FetchCacheOptions } from "#store/fetch/cache";

import { createEndpointClient } from "./endpoints";

export interface PatchSmithCacheOptions extends FetchCacheOptions {
  apps?: FetchCacheOptions;
  slot?: FetchCacheOptions;
}

export interface PatchSmithFetchClientOptions {
  contract?: PatchSmithContract;
  tools?: ToolImplementations<PatchSmithContract["tools"], "client">;
  baseUrl: string | URL;
  fetch?: typeof fetch;
  cache?: PatchSmithCacheOptions;
}

/** Share this client between roots to share endpoint requests and cached responses. */
export const createPatchSmithFetchClient = (
  options: PatchSmithFetchClientOptions
) => {
  const endpoints = createEndpointClient(options);
  const cache = createFetchCache(options.cache);
  const { baseUrl } = endpoints;
  const prefix = ["patchsmith", baseUrl.toString()] as const;
  return {
    apps: (settings: FetchCacheOptions = {}) =>
      cache.getStore([...prefix, "apps"], endpoints.apps, {
        ...options.cache?.apps,
        ...settings,
      }),
    baseUrl,
    cache,
    cacheOptions: options.cache,
    clear: () => {
      cache.clear();
      endpoints.clearSessions();
    },
    endpoints,
  };
};

export type PatchSmithFetchClient = ReturnType<
  typeof createPatchSmithFetchClient
>;
