import { appsInstall } from "@tailorkit/client-platform/client";
import type { Client } from "@tailorkit/client-platform/client/client/index";
import { z } from "zod";

import { selectTailorKitScopes, validateTailorKitScopes } from "./scope";
import type { TailorKitScopeSchemas } from "./scope";
import type {
  TailorKitInstallAppOptions,
  TailorKitPlatformOptions,
} from "./types";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

export const createExperimental = (options: {
  platform: Client;
  platformHeaders?: TailorKitPlatformOptions["headers"];
  scopeSchemas: TailorKitScopeSchemas;
}) => ({
  installApp: async <TScopes>(input: TailorKitInstallAppOptions<TScopes>) => {
    if (!input.appId || input.appId.length > 256) {
      throw new TypeError("A deployed app ID is required.");
    }
    const scope = z
      .strictObject({ name: z.string(), value: z.unknown() })
      .parse(input.scope);
    const scopes = await validateTailorKitScopes(options.scopeSchemas, {
      [scope.name]: scope.value,
    });
    const [validatedScope] = selectTailorKitScopes(scopes, [scope.name]);
    if (!validatedScope) {
      throw new TypeError("An installation scope is required.");
    }
    const headers = await (isFunctionValue(options.platformHeaders)
      ? options.platformHeaders()
      : options.platformHeaders);
    if (
      !(
        new Headers(headers).get("authorization")?.startsWith("Bearer ") ===
        true
      )
    ) {
      throw new Error("A TailorKit projectKey is required to install apps.");
    }
    const { data } = await appsInstall({
      body: { scope: validatedScope },
      client: options.platform,
      headers,
      path: { appId: input.appId },
      responseStyle: "fields",
      throwOnError: true,
    });
    return data;
  },
});
