import type { Client as PlatformClient } from "@patchsmith/client-platform/client/client/index";

import type { PatchSmithSchema } from "#schema/index";

import type { PatchSmithScopeSchemas } from "./scope";
import type { PatchSmithPlatformOptions, PatchSmithScopes } from "./types";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

export interface PatchSmithRuntimeContext {
  subjectId?: string;
  scopes: PatchSmithScopes;
}

export interface Context {
  platform: PlatformClient;
  platformHeaders: Record<string, string>;
  request: Request;
  schema: PatchSmithSchema;
  scopeSchemas: PatchSmithScopeSchemas;
  patchsmith?: PatchSmithRuntimeContext;
  authenticate: (ctx: {
    request: Request;
  }) =>
    | PatchSmithRuntimeContext
    | null
    | Promise<PatchSmithRuntimeContext | null>;
}

export interface CreateContextOptions {
  platform: PlatformClient;
  platformHeaders?: PatchSmithPlatformOptions["headers"];
  request: Request;
  schema: PatchSmithSchema;
  scopeSchemas: PatchSmithScopeSchemas;
  authenticate: (ctx: {
    request: Request;
  }) =>
    | PatchSmithRuntimeContext
    | null
    | Promise<PatchSmithRuntimeContext | null>;
}

export const createContext = async (
  options: CreateContextOptions
): Promise<Context> => {
  const configuredHeaders = await (isFunctionValue(options.platformHeaders)
    ? options.platformHeaders()
    : options.platformHeaders);

  const platformHeaders = Object.fromEntries(new Headers(configuredHeaders));

  return {
    authenticate: options.authenticate,
    platform: options.platform,
    platformHeaders,
    request: options.request,
    schema: options.schema,
    scopeSchemas: options.scopeSchemas,
  };
};
