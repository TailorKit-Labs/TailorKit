import type {
  TailorKitContract,
  ToolImplementations,
} from "@tailorkit/core/schema";

import { createFetchCache } from "#store/fetch/cache";
import type { FetchCacheOptions } from "#store/fetch/cache";

import { createEndpointClient } from "./endpoints";

export interface TailorKitCacheOptions extends FetchCacheOptions {
  apps?: FetchCacheOptions;
  slot?: FetchCacheOptions;
}

export interface TailorKitFetchClientOptions {
  contract?: TailorKitContract;
  tools?: ToolImplementations<TailorKitContract["tools"], "client">;
  baseUrl: string | URL;
  fetch?: typeof fetch;
  cache?: TailorKitCacheOptions;
}

/** Share this client between roots to share endpoint requests and cached responses. */
export const createTailorKitFetchClient = (
  options: TailorKitFetchClientOptions
) => {
  const endpoints = createEndpointClient(options);
  const cache = createFetchCache(options.cache);
  const { baseUrl } = endpoints;
  const prefix = ["tailorkit", baseUrl.toString()] as const;
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

export type TailorKitFetchClient = ReturnType<
  typeof createTailorKitFetchClient
>;
