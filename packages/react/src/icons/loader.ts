import {
  iconNamePattern,
  lucideVersion,
  parseIconData,
  validateIconOptions,
} from "@tailorkit/core/icons";
import type { IconData, IconOptions } from "@tailorkit/core/icons";

export interface IconRendererOptions extends IconOptions {
  /** Catalogue origin or directory; defaults to TailorKit's hosted catalogue. */
  baseUrl?: string | URL;
  fetch?: typeof globalThis.fetch;
}

const maxCacheEntries = 512;
const requestTimeoutMs = 10_000;
const maxIconBytes = 32_768;

export const createIconLoader = (options: IconRendererOptions) => {
  validateIconOptions(options);
  const baseUrl = new URL(options.baseUrl ?? "https://icons.tailorkit.app/");
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("Icon baseUrl must be an HTTP(S) catalogue URL");
  }
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname += "/";
  }
  const cache = new Map<string, Promise<IconData>>();
  const loaded = new Map<string, IconData>();

  const fetchIcon = async (name: string): Promise<IconData> => {
    const url = new URL(
      `${options.library}/${lucideVersion}/${name}.json`,
      baseUrl
    );
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      credentials: "omit",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Unable to load icon: ${name}`);
    }
    const text = await response.text();
    if (text.length > maxIconBytes) {
      throw new Error("Icon data is too large");
    }
    return parseIconData(JSON.parse(text));
  };

  return {
    load: async (name: string): Promise<IconData> => {
      if (name.length > 100 || !iconNamePattern.test(name)) {
        throw new Error("Invalid icon name");
      }
      const existing = cache.get(name);
      if (existing) {
        return await existing;
      }
      const request = fetchIcon(name);
      cache.set(name, request);
      if (cache.size > maxCacheEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
          loaded.delete(oldest);
        }
      }
      try {
        const data = await request;
        if (cache.get(name) === request) {
          loaded.set(name, data);
        }
        return data;
      } catch (error) {
        // Failed loads may be retried on a later mount; never poison the cache.
        if (cache.get(name) === request) {
          cache.delete(name);
        }
        throw error;
      }
    },
    peek: (name: string) => loaded.get(name),
  };
};
