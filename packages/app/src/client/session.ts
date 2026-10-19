import * as v from "valibot";

import { AppError } from "#errors";
import type { Identity } from "#server/functions";
import { jsonValueSchema } from "#validation";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const identitySchema = v.object({
  appId: v.string(),
  deploymentId: v.string(),
  expiresAt: v.pipe(v.number(), v.finite()),
  installationId: v.string(),
  projectId: v.string(),
  scope: v.object({
    name: v.string(),
    value: v.record(v.string(), jsonValueSchema),
  }),
  subjectId: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  toolUrl: v.string(),
});
const sessionSchema = v.object({
  expiresAt: v.pipe(v.number(), v.finite()),
  identity: v.optional(identitySchema),
  subjectId: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
  token: v.string(),
  toolUrl: v.optional(v.string()),
  url: v.string(),
});

export const parseSession = (value: Parameters<typeof v.parse>[1]): Session =>
  v.parse(sessionSchema, value);

const APP_SESSION_RENEWAL_MS = 60_000;

export interface Session {
  toolUrl?: string;
  identity?: Identity;
  subjectId: string;
  token: string;
  expiresAt: number;
  url: string;
}

const freezeIdentity = <T>(value: T): T => {
  if (isObjectValue(value) && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      freezeIdentity(child);
    }
    Object.freeze(value);
  }
  return value;
};

export const sessionRenewalDelay = (session: Session) =>
  Math.max(500, session.expiresAt - Date.now() - APP_SESSION_RENEWAL_MS);

/** Host-owned provider: project credentials never cross into the sandbox. */
export const createSessionProvider = (options: {
  baseUrl: string | URL;
  appId: string;
  fetch?: typeof fetch;
}) => {
  const base = new URL(options.baseUrl, globalThis.location?.href);
  if (!base.pathname.endsWith("/")) {
    base.pathname += "/";
  }
  let cached: Session | undefined;
  let pending: Promise<Session> | undefined;
  return async (input: { refresh: boolean }): Promise<Session> => {
    if (
      !input.refresh &&
      cached &&
      cached.expiresAt > Date.now() + APP_SESSION_RENEWAL_MS
    ) {
      return cached;
    }
    pending ??= (async () => {
      try {
        return await (async () => {
          const response = await (async () => {
            try {
              return await (options.fetch ?? fetch)(
                new URL("backend/session", base),
                {
                  body: JSON.stringify({ appId: options.appId }),
                  credentials: "same-origin",
                  headers: { "content-type": "application/json" },
                  method: "POST",
                }
              );
            } catch {
              throw new AppError(
                "UNAVAILABLE",
                "Unable to reach the app session provider"
              );
            }
          })();
          if (!response.ok) {
            const code = response.status === 403 ? "FORBIDDEN" : "UNAVAILABLE";
            throw new AppError(
              response.status === 401 ? "UNAUTHORIZED" : code,
              "Unable to authorize the app backend"
            );
          }
          const parsed = v.safeParse(sessionSchema, await response.json());
          if (!parsed.success) {
            throw new AppError("UNAVAILABLE", "Invalid app session");
          }
          cached = parsed.output;
          if (cached.identity) {
            cached.identity = freezeIdentity(cached.identity);
          }
          return cached;
        })();
      } finally {
        pending = undefined;
      }
    })();
    return await pending;
  };
};
