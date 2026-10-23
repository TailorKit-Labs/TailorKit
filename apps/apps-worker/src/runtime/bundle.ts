import type { AppDefinition, ApplicationModule } from "@patchsmith/app/server";
import { z } from "zod";

import type { Persistence } from "./database/driver";
import { AppError } from "./errors";
import { createExecution } from "./execution";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const bundle = z.object({
  default: z.custom<AppDefinition>(
    (value) =>
      isObjectValue(value) &&
      value !== null &&
      "functions" in value &&
      isObjectValue(value.functions) &&
      value.functions !== null &&
      !Array.isArray(value.functions)
  ),
  migrations: z.array(
    z.object({
      hash: z.string(),
      id: z.string(),
      statements: z.array(z.string()),
    })
  ),
  runtimeManifest: z.object({
    apiVersion: z.number().int(),
    requires: z.array(z.string()),
  }),
});

const supportedFeatures = new Set([
  "database",
  "actions",
  "database-relations",
  "tools",
  "internal-functions",
  "hooks",
  "nested-actions",
]);

/** Check compatibility before creating tables or applying any application migrations. */
export const createApplicationExecution = (
  application: Parameters<typeof bundle.safeParse>[0],
  persistence: Persistence
) => {
  const parsed = bundle.safeParse(application);

  if (!parsed.success) {
    throw new AppError(
      "INCOMPATIBLE_VERSION",
      "Invalid application bundle exports"
    );
  }

  const module: ApplicationModule = parsed.data;

  if (module.runtimeManifest.apiVersion !== 1) {
    throw new AppError(
      "INCOMPATIBLE_VERSION",
      `Unsupported application API version: ${module.runtimeManifest.apiVersion}`
    );
  }

  const unsupported = module.runtimeManifest.requires.filter(
    (feature) => !supportedFeatures.has(feature)
  );

  if (unsupported.length) {
    throw new AppError(
      "INCOMPATIBLE_VERSION",
      `Unsupported application features: ${unsupported.join(", ")}`
    );
  }

  return createExecution(module.default, persistence, module.migrations);
};
