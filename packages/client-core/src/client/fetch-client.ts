import type {
  PatchsmithContract,
  ToolImplementations,
} from "@patchsmith/core/schema";

import { createFetchCache } from "#store/fetch/cache";
import type { FetchCacheOptions } from "#store/fetch/cache";

import { createEndpointClient } from "./endpoints";

export interface PatchsmithCacheOptions extends FetchCacheOptions {
  apps?: FetchCacheOptions;
  slot?: FetchCacheOptions;
}

export interface PatchsmithFetchClientOptions {
  contract?: PatchsmithContract;
  tools?: ToolImplementations<PatchsmithContract["tools"], "client">;
  baseUrl: string | URL;
  fetch?: typeof fetch;
  cache?: PatchsmithCacheOptions;
}

/** Share this client between roots to share endpoint requests and cached responses. */
export const createPatchsmithFetchClient = (
  options: PatchsmithFetchClientOptions
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

export type PatchsmithFetchClient = ReturnType<
  typeof createPatchsmithFetchClient
>;
