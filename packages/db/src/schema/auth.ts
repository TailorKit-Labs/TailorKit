export * from "./auth.generated";

import type { organization } from "./auth.generated";

export type Organization = typeof organization.$inferSelect;
