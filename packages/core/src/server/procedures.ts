import { createORPCErrorFromJson, isORPCErrorJson } from "@orpc/client";
import { ORPCError, os } from "@orpc/server";
import { cliAuthVerifyToken } from "@patchsmith/client-platform/client";

import type { Context } from "./context";
import { normalizePatchsmithNamedScope, selectPatchsmithScopes } from "./scope";
import type { PatchsmithNamedScope, PatchsmithScopes } from "./types";

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

export const o = os.$context<Context>();

export const getPatchsmithContext = (context: Context) => {
  if (!context.patchsmith) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized." });
  }

  return context.patchsmith;
};

export const getPatchsmithScope = (
  context: Context,
  name?: string
): PatchsmithNamedScope => {
  const { scopes } = getPatchsmithContext(context);
  const names = name === undefined ? Object.keys(scopes) : [name];

  if (names.length !== 1) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Choose one Patchsmith scope for this operation.",
    });
  }

  try {
    return require(selectPatchsmithScopes(scopes, names)[0]);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        error instanceof Error
          ? error.message
          : "Invalid Patchsmith scope selection.",
    });
  }
};

export const getPatchsmithScopes = (
  context: Context,
  names?: string[]
): PatchsmithNamedScope[] => {
  try {
    return selectPatchsmithScopes(getPatchsmithContext(context).scopes, names);
  } catch (error) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        error instanceof Error
          ? error.message
          : "Invalid Patchsmith scope selection.",
    });
  }
};

export const getCliDeployToken = (request: Request): string => {
  const [scheme, token] =
    request.headers.get("authorization")?.split(" ") ?? [];

  if (
    scheme !== "Bearer" ||
    !(token !== undefined && token !== null && token !== "")
  ) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Missing CLI deploy token.",
    });
  }

  return token;
};

const verifyCliDeployToken = async (context: Context) => {
  try {
    return await cliAuthVerifyToken({
      body: {
        deployToken: getCliDeployToken(context.request),
      },
      client: context.platform,
      headers: context.platformHeaders,
    });
  } catch (error) {
    if (isORPCErrorJson(error)) {
      throw createORPCErrorFromJson(error);
    }

    throw error;
  }
};

export const requireCliDeployToken = o.middleware(async ({ context, next }) => {
  const result = await verifyCliDeployToken(context);

  const token = "data" in result ? result.data : result;

  if (!token?.scope) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid CLI deploy token.",
    });
  }

  let scopes: PatchsmithScopes;

  try {
    const scope = normalizePatchsmithNamedScope(token.scope);

    if (!Object.hasOwn(context.scopeSchemas, scope.name)) {
      throw new TypeError("CLI token uses an undeclared scope.");
    }

    scopes = Object.freeze({ [scope.name]: scope.value });
  } catch {
    throw new ORPCError("UNAUTHORIZED", {
      message: "Invalid CLI deploy token.",
    });
  }

  return await next({ context: { patchsmith: { scopes } } });
});

export const requireHostAuth = o.middleware(async ({ context, next }) => {
  const patchsmith = await context.authenticate({ request: context.request });

  if (!patchsmith) {
    throw new ORPCError("UNAUTHORIZED", { message: "Unauthorized." });
  }

  return await next({ context: { patchsmith } });
});
