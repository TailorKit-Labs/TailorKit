import { App } from "@patchsmith/db/schema/apps";
import { z } from "zod";

/** Exactly one namespace: a slug may also look like a short ID or UUID. */
export const appSelectorSchema = z.union([
  z.strictObject({ id: z.uuid() }),
  z.strictObject({ shortId: App.shape.shortId }),
  z.strictObject({ slug: App.shape.slug }),
]);

export type AppSelector = z.infer<typeof appSelectorSchema>;
