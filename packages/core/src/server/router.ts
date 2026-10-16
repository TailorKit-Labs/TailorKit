import type { RouterClient } from "@orpc/server";

import { appAgentRouter } from "./routes/app-agent";
import { appRouter } from "./routes/apps";
import { cliAuthRouter } from "./routes/cli-auth";
import { deploymentRouter } from "./routes/deployments";

export const tailorkitRouter = {
  appAgent: appAgentRouter,
  apps: appRouter,
  cliAuth: cliAuthRouter,
  deployments: deploymentRouter,
};

export type TailorKitRouter = typeof tailorkitRouter;
export type TailorKitRouterClient = RouterClient<TailorKitRouter>;
