import type { RouterClient } from "@orpc/server";

import { appsRouter } from "./apps";
import { orgRouter } from "./org";
import { projectRouter } from "./project";
import { userRouter } from "./user";

export const appRouter = {
  apps: appsRouter,
  org: orgRouter,
  project: projectRouter,
  user: userRouter,
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
