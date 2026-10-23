import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { dash } from "@better-auth/infra";
import { passkey } from "@better-auth/passkey";
import { createDb } from "@patchsmith/db";
import * as schema from "@patchsmith/db/schema/auth";
import {
  sendBetterAuthOtpEmail,
  sendOrganizationInvitationEmail,
} from "@patchsmith/email";
import {
  getBaseUrl,
  getProductionUrl,
  getTrustedOrigins,
} from "@patchsmith/env";
import { getKV } from "@patchsmith/kv";
import { initializeObservability } from "@patchsmith/observability";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";
import type { BetterAuthOptions, SecondaryStorage } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { betterAuth } from "better-auth/minimal";
import { captcha, haveIBeenPwned } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { checkBotId } from "botid/server";

import { env } from "#env";
import { projectHostKeys } from "#project-host";

import { captchaEndpoints } from "./lib/captcha-endpoints";
import { ac, roles } from "./lib/permissions";
import {
  initializeTenantShortId,
  tenantShortIdField,
} from "./lib/tenant-short-id";

void initializeObservability("patchsmith-web");

const noopWaitUntil = (promise: Promise<unknown>): void => {
  void promise;
};

// Better Auth only challenges credential sign-ins by default. Intercept direct
// and OAuth-proxy callbacks before their newly created sessions become usable,
// then issue the same short-lived challenge used by the two-factor plugin.
const enforceTwoFactorAfterSocialSignIn = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/callback/:id" && ctx.path !== "/oauth-proxy-callback") {
    /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
    return undefined;
  }

  const { newSession } = ctx.context;
  const user = newSession?.user;

  if (
    !newSession ||
    !user ||
    !("twoFactorEnabled" in user) ||
    user.twoFactorEnabled !== true
  ) {
    /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
    return undefined;
  }

  deleteSessionCookie(ctx, true);
  await ctx.context.internalAdapter.deleteSession(newSession.session.token);
  ctx.context.setNewSession(null);

  const maxAge = 600;

  const twoFactorCookie = ctx.context.createAuthCookie("two_factor", {
    maxAge,
  });

  const identifier = `2fa-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + maxAge * 1000);

  await ctx.context.internalAdapter.createVerificationValue({
    expiresAt,
    identifier,
    value: user.id,
  });
  await ctx.context.internalAdapter.createVerificationValue({
    expiresAt,
    identifier: `2fa-attempts-${identifier}`,
    value: "0",
  });
  await ctx.setSignedCookie(
    twoFactorCookie.name,
    identifier,
    ctx.context.secret,
    twoFactorCookie.attributes
  );

  return ctx.redirect(new URL("/two-factor", getBaseUrl(env)).toString());
});

const createSecondaryStorage = (): SecondaryStorage | undefined => {
  const kv = getKV();

  if (!kv) {
    return undefined;
  }

  return {
    delete: async (key: string) => {
      await kv.delete(key);
    },
    get: async (key: string) => await kv.get(key),
    getAndDelete: async (key: string) => await kv.getAndDelete(key),
    increment: async (key: string, ttl: number) => await kv.increment(key, ttl),
    set: async (key: string, value: string, ttl?: number) => {
      await kv.set(key, value, { ttl });
    },
  };
};

const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};

if (
  env.GITHUB_CLIENT_ID !== undefined &&
  env.GITHUB_CLIENT_ID !== null &&
  env.GITHUB_CLIENT_ID !== "" &&
  env.GITHUB_CLIENT_SECRET !== undefined &&
  env.GITHUB_CLIENT_SECRET !== null &&
  env.GITHUB_CLIENT_SECRET !== ""
) {
  socialProviders.github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    scope: ["user:email"],
  };
}

if (
  env.GOOGLE_CLIENT_ID !== undefined &&
  env.GOOGLE_CLIENT_ID !== null &&
  env.GOOGLE_CLIENT_ID !== "" &&
  env.GOOGLE_CLIENT_SECRET !== undefined &&
  env.GOOGLE_CLIENT_SECRET !== null &&
  env.GOOGLE_CLIENT_SECRET !== ""
) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

export const getSocialProviderAvailability = () => ({
  github: "github" in socialProviders,
  google: "google" in socialProviders,
});

const buildAuth = () => {
  const db = createDb();

  const backgroundTaskHandler =
    env.VERCEL === true ? vercelWaitUntil : noopWaitUntil;

  const secondaryStorage = createSecondaryStorage();
  const productionUrl = getProductionUrl(env);

  const passkeyRpID =
    env.VERCEL_ENV === "production"
      ? new URL(productionUrl ?? getBaseUrl(env)).hostname
      : new URL(getBaseUrl(env)).hostname;

  return betterAuth({
    account: {
      accountLinking: {
        allowDifferentEmails: true,
      },
      encryptOAuthTokens: true,
    },

    advanced: {
      backgroundTasks: {
        handler: backgroundTaskHandler,
      },
      cookiePrefix:
        env.VERCEL_TARGET_ENV === "production"
          ? "patchsmith"
          : "patchsmith-dev",
      database: {
        generateId: "uuid",
        joins: true,
      },
      ipAddress: {
        ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
      },
    },

    appName: "Patchsmith",

    baseURL: getBaseUrl(env),

    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      transaction: true,
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
    },

    emailVerification: {
      sendOnSignUp: false,
    },

    hooks: {
      after: enforceTwoFactorAfterSocialSignIn,
    },

    onAPIError: {
      // Keep OAuth failures in the application instead of Better Auth's
      // development-oriented default error page.
      errorURL: "/auth/error",
    },

    plugins: [
      captcha({
        checkBotId,
        endpoints: captchaEndpoints,
        provider: "vercel-botid",
      }),
      haveIBeenPwned(),
      passkey({
        rpID: passkeyRpID,
        rpName: "Patchsmith",
      }),
      twoFactor({
        // OAuth-only accounts must create a password through the verified-email
        // recovery flow before they can enroll a second factor.
        allowPasswordless: false,
        issuer: "Patchsmith",
      }),
      emailOTP({
        expiresIn: 600,
        overrideDefaultEmailVerification: true,
        // oxlint-disable-next-line eslint/require-await -- This asynchronous protocol method resolves synchronously but must preserve Promise results and rejected exceptions.
        sendVerificationOTP: async ({ email, otp, type }) => {
          backgroundTaskHandler(sendBetterAuthOtpEmail({ email, otp, type }));
        },
        sendVerificationOnSignUp: false,
        storeOTP: "hashed",
      }),
      organization({
        ac,
        allowUserToCreateOrganization: false,
        organizationHooks: {
          // oxlint-disable-next-line eslint/require-await -- This asynchronous protocol method resolves synchronously but must preserve Promise results and rejected exceptions.
          beforeCreateOrganization: async ({
            organization: organizationValue,
          }) => initializeTenantShortId(organizationValue),
        },
        roles,
        schema: {
          organization: {
            additionalFields: {
              shortId: tenantShortIdField,
              slug: {
                fieldName: "slug",
                required: true,
                type: "string",
                unique: true,
              },
            },
          },
        },
        sendInvitationEmail: async (data) => {
          await sendOrganizationInvitationEmail({
            email: data.email,
            invitationId: data.id,
            inviterName: data.inviter.user.name,
            organizationName: data.organization.name,
            role: data.role,
          });
        },
      }),
      projectHostKeys(secondaryStorage),
      ...(env.BETTER_AUTH_API_KEY !== undefined &&
      env.BETTER_AUTH_API_KEY !== null &&
      env.BETTER_AUTH_API_KEY !== ""
        ? [
            dash({
              apiKey: env.BETTER_AUTH_API_KEY,
            }),
          ]
        : []),
      ...(productionUrl !== undefined &&
      productionUrl !== null &&
      productionUrl !== "" &&
      env.OAUTH_PROXY_SECRET !== undefined &&
      env.OAUTH_PROXY_SECRET !== null &&
      env.OAUTH_PROXY_SECRET !== ""
        ? [
            oAuthProxy({
              productionURL: productionUrl,
              secret: env.OAUTH_PROXY_SECRET,
            }),
          ]
        : []),
      tanstackStartCookies(),
    ],

    secondaryStorage,

    secret: env.AUTH_SECRET,

    // Better Auth still resolves the session model through the DB adapter in
    // some auth flows when secondaryStorage is configured.
    session: {
      storeSessionInDatabase: true,
    },

    socialProviders,

    trustedOrigins: getTrustedOrigins(env),

    user: {
      additionalFields: {
        theme: {
          defaultValue: "system",
          fieldName: "theme",
          required: false,
          type: "string",
        },
      },
    },
  });
};

export const createAuth = (): ReturnType<typeof buildAuth> => buildAuth();

export const auth: ReturnType<typeof buildAuth> = createAuth();

export type Session = typeof auth.$Infer.Session.session;

export type User = typeof auth.$Infer.Session.user;
