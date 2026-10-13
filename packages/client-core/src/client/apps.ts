import type { TailorKitApp } from "#types";

export const matchesApp = (
  app: TailorKitApp,
  scopes?: readonly string[],
  appIds?: readonly string[]
): boolean =>
  (scopes === undefined ||
    (app.scope !== undefined && scopes.includes(app.scope.name))) &&
  (appIds === undefined || appIds.includes(app.id));
