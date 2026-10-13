import { z } from "zod";

import { AppError } from "#errors";
import type { Identity } from "#server/functions";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const identitySchema = z.object({
  appId: z.string(),
  deploymentId: z.string(),
  expiresAt: z.number(),
  installationId: z.string(),
  projectId: z.string(),
  scope: z.object({ name: z.string(), value: z.record(z.string(), z.json()) }),
  subjectId: z.string().optional(),
  toolUrl: z.string(),
});
const sessionSchema = z.object({
  expiresAt: z.number(),
  identity: identitySchema.optional(),
  subjectId: z.string().optional(),
  token: z.string(),
  toolUrl: z.string().optional(),
  url: z.string(),
});

export const parseSession = (
  value: Parameters<typeof sessionSchema.parse>[0]
): Session => sessionSchema.parse(value);

const APP_SESSION_RENEWAL_MS = 60_000;

export interface Session {
  toolUrl?: string;
  identity?: Identity;
  subjectId?: string;
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
          const parsed = sessionSchema.safeParse(await response.json());
          if (!parsed.success) {
            throw new AppError("UNAVAILABLE", "Invalid app session");
          }
          cached = parsed.data;
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
