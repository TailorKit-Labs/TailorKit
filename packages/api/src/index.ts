import type { InferClientError } from "@orpc/client";
import type { RouterClient } from "@orpc/server";

import type { AppRouter } from "./routers/index";

export { appRouter } from "./routers/index";

type AppError = InferClientError<RouterClient<AppRouter>>;

export { createContext } from "./context";

export type { AppRouter } from "./routers/index";

export type { AppRouterClient } from "./routers/index";

export type { AppError };
