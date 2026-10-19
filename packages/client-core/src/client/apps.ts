import type { PatchSmithApp } from "#types";

export const matchesApp = (
  app: PatchSmithApp,
  scopes?: readonly string[],
  appIds?: readonly string[]
): boolean =>
  (scopes === undefined ||
    (app.scope !== undefined && scopes.includes(app.scope.name))) &&
  (appIds === undefined || appIds.includes(app.id));
