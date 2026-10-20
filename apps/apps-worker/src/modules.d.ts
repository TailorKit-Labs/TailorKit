declare module "application.js" {
  import type { ApplicationModule } from "@patchsmith/app/server";

  const app: ApplicationModule["default"];
  export default app;
  export const migrations: ApplicationModule["migrations"];
  export const runtimeManifest: ApplicationModule["runtimeManifest"];
}
