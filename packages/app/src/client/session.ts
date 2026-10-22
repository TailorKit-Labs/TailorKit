import * as v from "valibot";

import { AppError } from "#errors";
import { sessionSchema } from "#protocol";
import type { Session } from "#protocol";

export type { Session } from "#protocol";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

export const parseSession = (value: Parameters<typeof v.parse>[1]): Session =>
  v.parse(sessionSchema, value);

const APP_SESSION_RENEWAL_MS = 60_000;

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
          cached.identity = freezeIdentity(cached.identity);

          return cached;
        })();
      } finally {
        pending = undefined;
      }
    })();

    return await pending;
  };
};
