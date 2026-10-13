import { validateTailorKitScopes } from "./scope";
import type { TailorKitScopeSchemas } from "./scope";
import type { TailorKitHostContext, TailorKitPlatformOptions } from "./types";

const maximumContextHeaderLength = 8192;

/** Prepare standard HTTP MCP client configuration; no host route or custom fetch is needed. */
export const createMcpTransport = (options: {
  hostUrl: string;
  platformUrl: string;
  platformHeaders?: TailorKitPlatformOptions["headers"];
  scopeSchemas: TailorKitScopeSchemas;
}) => ({
  async transport(context: TailorKitHostContext<unknown>): Promise<{
    url: string;
    headers: Record<string, string>;
  }> {
    if (
      context.subjectId !== undefined &&
      (typeof context.subjectId !== "string" ||
        !context.subjectId ||
        context.subjectId.length > 256)
    ) {
      throw new TypeError("Invalid MCP subjectId.");
    }
    const scopes = await validateTailorKitScopes(
      options.scopeSchemas,
      context.scopes
    );
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        hostUrl: options.hostUrl,
        scopes,
        subjectId: context.subjectId,
      })
    );
    if (bytes.length > (maximumContextHeaderLength * 3) / 4) {
      throw new TypeError(
        "MCP context exceeds the 8 KiB header limit. Supply fewer scopes."
      );
    }
    const encoded = btoa(String.fromCodePoint(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
    const configured = await (typeof options.platformHeaders === "function"
      ? options.platformHeaders()
      : options.platformHeaders);
    const headers = new Headers(configured);
    if (!headers.get("authorization")?.startsWith("Bearer ")) {
      throw new Error("A TailorKit projectKey is required for MCP transport.");
    }
    headers.set("x-tailorkit-context", encoded);
    return {
      headers: Object.fromEntries(headers),
      url: `${options.platformUrl.replace(/\/$/u, "")}/app-agent/mcp`,
    };
  },
});
