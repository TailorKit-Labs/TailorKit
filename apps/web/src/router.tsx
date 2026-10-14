import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { NotFound } from "./components/not-found";
import { getQueryClient, orpc } from "./lib/orpc";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = getQueryClient();

  const router = createRouter({
    context: { orpc, queryClient },
    defaultNotFoundComponent: NotFound,
    defaultPreload: "intent",
    routeTree,
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({
    queryClient,
    router,
  });

  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
