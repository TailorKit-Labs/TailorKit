import type { organization } from "./auth.generated";

// oxlint-disable-next-line oxc/no-barrel-file -- This file is a supported package or framework entry point; preserve its public exports.
export * from "./auth.generated";

export type Organization = typeof organization.$inferSelect;
