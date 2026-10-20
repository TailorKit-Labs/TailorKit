import type { Client as PlatformClient } from "@patchsmith/client-platform/client/client/index";

import type { PatchsmithSchema } from "#schema/index";

import type { PatchsmithScopeSchemas } from "./scope";
import type { PatchsmithPlatformOptions, PatchsmithScopes } from "./types";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

export interface PatchsmithRuntimeContext {
  subjectId: string;
  scopes: PatchsmithScopes;
}

export interface Context {
  platform: PlatformClient;
  platformHeaders: Record<string, string>;
  request: Request;
  schema: PatchsmithSchema;
  scopeSchemas: PatchsmithScopeSchemas;
  /** Scope authorization shared by host sessions and CLI deployment grants. */
  patchsmith?: Pick<PatchsmithRuntimeContext, "scopes">;
  authenticate: (ctx: {
    request: Request;
  }) =>
    | PatchsmithRuntimeContext
    | null
    | Promise<PatchsmithRuntimeContext | null>;
}

export interface CreateContextOptions {
  platform: PlatformClient;
  platformHeaders?: PatchsmithPlatformOptions["headers"];
  request: Request;
  schema: PatchsmithSchema;
  scopeSchemas: PatchsmithScopeSchemas;
  authenticate: (ctx: {
    request: Request;
  }) =>
    | PatchsmithRuntimeContext
    | null
    | Promise<PatchsmithRuntimeContext | null>;
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
