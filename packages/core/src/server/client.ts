import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { PatchSmithRouterClient } from "./router";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

type HeaderInput = ConstructorParameters<typeof Headers>[0];

export interface PatchSmithClientOptions {
  fetch?: typeof fetch;
  headers?: HeaderInput | (() => HeaderInput | Promise<HeaderInput>);
  url: string;
}

export const createPatchSmithClient = (
  options: PatchSmithClientOptions
): PatchSmithRouterClient => {
  const url = URL.canParse(options.url) ? new URL(options.url) : undefined;
  // SAFETY: The configured URL is normalized into a pathname before the client uses it as an absolute route path.
  const link = new RPCLink({
    fetch: async (urlValue, init) => {
      const configuredHeaders = await (isFunctionValue(options.headers)
        ? options.headers()
        : options.headers);
      const headers = new Headers(configuredHeaders);
      for (const [key, value] of new Headers(init.headers)) {
        headers.set(key, value);
      }

      return await (options.fetch ?? fetch)(urlValue, {
        ...init,
        headers,
      });
    },
    origin: url?.origin,
    url:
      /* oxlint-disable typescript/no-unsafe-type-assertion -- The configured URL is normalized into a pathname before the client uses it as an absolute route path. */
      (url
        ? `${url.pathname}${url.search}${url.hash}`
        : options.url) as `/${string}`,
    /* oxlint-enable typescript/no-unsafe-type-assertion */
  });

  return createORPCClient<PatchSmithRouterClient>(link);
};
