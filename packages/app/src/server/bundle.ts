import type { AppDefinition } from "./functions";
import type { AppMigration } from "../protocol";

/** Interface between an uploaded application module and the server runtime. */
export interface RuntimeManifest {
  apiVersion: number;
  requires: readonly string[];
}
export interface ApplicationModule {
  default: AppDefinition;
  migrations: readonly AppMigration[];
  runtimeManifest: RuntimeManifest;
}
