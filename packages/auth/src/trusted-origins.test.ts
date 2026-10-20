import { getBaseUrl, getTrustedOrigins } from "@patchsmith/env";
import { betterAuth } from "better-auth/minimal";
import { describe, expect, it } from "vite-plus/test";
import * as z from "zod";

const productionEnv = {
  AUTH_PRODUCTION_URL: "https://patchsmith.io/",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "tailorkit.dev",
};

describe("auth deployment URLs", () => {
  it("uses the explicit production URL for auth and trusted origins", async () => {
    const auth = betterAuth({
      baseURL: getBaseUrl(productionEnv),
      secret: "test-secret-with-at-least-32-characters",
      trustedOrigins: getTrustedOrigins(productionEnv),
    });
    const context = await auth.$context;

    expect(context.baseURL).toBe("https://patchsmith.io/api/auth");
    expect(context.isTrustedOrigin("https://patchsmith.io")).toBe(true);
    expect(context.isTrustedOrigin("https://unrelated.vercel.app")).toBe(false);
    expect(
      context.isTrustedOrigin("https://patchsmith.io.attacker.example")
    ).toBe(false);
  });

  it("starts GitHub sign-in with the production callback URL", async () => {
    const auth = betterAuth({
      baseURL: getBaseUrl(productionEnv),
      secret: "test-secret-with-at-least-32-characters",
      socialProviders: {
        github: {
          clientId: "test-github-client",
          clientSecret: "test-github-secret",
        },
      },
      trustedOrigins: getTrustedOrigins(productionEnv),
    });
    const response = await auth.handler(
      new Request("https://patchsmith.io/api/auth/sign-in/social", {
        body: JSON.stringify({
          callbackURL: "https://patchsmith.io/",
          disableRedirect: true,
          provider: "github",
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: "https://patchsmith.io",
        },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    const { url } = z.object({ url: z.url() }).parse(await response.json());
    const authorizationUrl = new URL(url);
    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://patchsmith.io/api/auth/callback/github"
    );
  });

  it("falls back to the platform production URL without an override", () => {
    expect(
      getBaseUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "patchsmith-web.vercel.app",
      })
    ).toBe("https://patchsmith-web.vercel.app");
  });

  it("keeps preview deployments on their own URLs", () => {
    const previewEnv = {
      ...productionEnv,
      VERCEL_BRANCH_URL: "patchsmith-git-feature-alfiejones.vercel.app",
      VERCEL_ENV: "preview",
      VERCEL_URL: "patchsmith-feature-alfiejones.vercel.app",
    };

    expect(getBaseUrl(previewEnv)).toBe(
      "https://patchsmith-feature-alfiejones.vercel.app"
    );
    expect(getTrustedOrigins(previewEnv)).toEqual([
      "https://patchsmith-feature-alfiejones.vercel.app",
      "https://patchsmith-git-feature-alfiejones.vercel.app",
    ]);
  });

  it("keeps local development on localhost with a production URL configured", () => {
    expect(
      getBaseUrl({
        AUTH_PRODUCTION_URL: "https://patchsmith.io",
        PORT: 4000,
      })
    ).toBe("http://localhost:4000");
  });
});

describe("AUTH_TRUSTED_ORIGINS preview pattern", () => {
  it("trusts only previews with the configured project prefix", async () => {
    const auth = betterAuth({
      baseURL: "https://patchsmith.io",
      secret: "test-secret-with-at-least-32-characters",
      trustedOrigins: ["https://tailorkit-*.vercel.app"],
    });
    const context = await auth.$context;

    expect(
      context.isTrustedOrigin("https://tailorkit-feature-auth.vercel.app")
    ).toBe(true);
    expect(
      context.isTrustedOrigin("https://another-project-feature-auth.vercel.app")
    ).toBe(false);
  });
});
