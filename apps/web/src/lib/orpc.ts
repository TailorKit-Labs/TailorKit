import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createRouterClient } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createContext, appRouter } from "@tailorkit/api";
import { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { deploymentHeaders } from "./deployment-headers";

export const getQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // Prevent SSR-prefetched queries from immediately refetching after hydration.
        staleTime: 60_000,
      },
    },
  });

const getORPCClient = createIsomorphicFn()
  .server(() =>
    createRouterClient(appRouter, {
      context: async () => await createContext({ request: getRequest() }),
    })
  )
  .client((): RouterClient<typeof appRouter> => {
    const link = new RPCLink({
      headers: deploymentHeaders,
      url: "/api/rpc",
    });

    return createORPCClient(link);
  });

export const client: RouterClient<typeof appRouter> = getORPCClient();

export const orpc = createTanstackQueryUtils(client);
