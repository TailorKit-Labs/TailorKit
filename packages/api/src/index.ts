import type { InferClientError } from "@orpc/client";
import type { RouterClient } from "@orpc/server";

import { appRouter } from "./routers/index";
import type { AppRouter, AppRouterClient } from "./routers/index";

type AppError = InferClientError<RouterClient<AppRouter>>;
export { appRouter, type AppRouter, type AppRouterClient, type AppError };
export { createContext } from "./context";
