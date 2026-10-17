import { os } from "@orpc/server";
import type { RouterClient } from "@orpc/server";

export const appRouter = {
  apps: os.lazy(async () => {
    const { appsRouter } = await import("./apps");
    return { default: appsRouter };
  }),
  org: os.lazy(async () => {
    const { orgRouter } = await import("./org");
    return { default: orgRouter };
  }),
  project: os.lazy(async () => {
    const { projectRouter } = await import("./project");
    return { default: projectRouter };
  }),
  user: os.lazy(async () => {
    const { userRouter } = await import("./user");
    return { default: userRouter };
  }),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
