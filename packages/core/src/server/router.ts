import type { RouterClient } from "@orpc/server";

import { appAgentRouter } from "./routes/app-agent";
import { appRouter } from "./routes/apps";
import { cliAuthRouter } from "./routes/cli-auth";
import { deploymentRouter } from "./routes/deployments";

export const patchsmithRouter = {
  appAgent: appAgentRouter,
  apps: appRouter,
  cliAuth: cliAuthRouter,
  deployments: deploymentRouter,
};

export type PatchsmithRouter = typeof patchsmithRouter;
export type PatchsmithRouterClient = RouterClient<PatchsmithRouter>;
