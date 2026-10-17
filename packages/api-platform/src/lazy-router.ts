import { openapi } from "@orpc/openapi";
import { Lazy, os } from "@orpc/server";
import type { AnyRouter } from "@orpc/server";

/** Match a lazy router by prefix without prepending it to its existing URLs. */
export const lazyOpenAPIRouter = <TRouter extends AnyRouter>(
  prefix: `/${string}`,
  loader: () => Promise<{ default: TRouter }>
): Lazy<TRouter> =>
  new Lazy({ loader, meta: os.meta(openapi({ prefix }))["~orpc"].meta });
