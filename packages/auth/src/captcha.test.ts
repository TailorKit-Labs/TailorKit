import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth/minimal";
import { captcha } from "better-auth/plugins";
import { checkBotId } from "botid/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { captchaEndpoints } from "./lib/captcha-endpoints";

vi.mock("botid/server", () => ({ checkBotId: vi.fn() }));

const authCaptcha = captcha({
  checkBotId,
  endpoints: captchaEndpoints,
  provider: "vercel-botid",
});

const options: BetterAuthOptions = {
  baseURL: "https://patchsmith.io",
  logger: { disabled: true },
  plugins: [authCaptcha],
  secret: "test-secret-with-at-least-32-characters",
};
const auth = betterAuth(options);

const humanVerdict = {
  bypassed: false,
  isBot: false,
  isHuman: true,
  isVerifiedBot: false,
};

describe("auth captcha", () => {
  beforeEach(() => {
    vi.mocked(checkBotId).mockReset();
  });

  it.each(captchaEndpoints)("rejects bots on %s", async (path) => {
    vi.mocked(checkBotId).mockResolvedValue({
      ...humanVerdict,
      isBot: true,
      isHuman: false,
    });

    const response = await auth.handler(
      new Request(`https://patchsmith.io/api/auth${path}`, { method: "POST" })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "VERIFICATION_FAILED",
    });
    expect(checkBotId).toHaveBeenCalledOnce();
  });

  it.each(captchaEndpoints)("allows humans on %s", async (path) => {
    vi.mocked(checkBotId).mockResolvedValue(humanVerdict);

    const result = await authCaptcha.onRequest(
      new Request(`https://patchsmith.io/api/auth${path}`, { method: "POST" }),
      await auth.$context
    );

    expect(result).toBeUndefined();
    expect(checkBotId).toHaveBeenCalledOnce();
  });

  it("rejects verified bots as well", async () => {
    vi.mocked(checkBotId).mockResolvedValue({
      ...humanVerdict,
      isBot: true,
      isHuman: false,
      isVerifiedBot: true,
    });

    const response = await auth.handler(
      new Request("https://patchsmith.io/api/auth/sign-in/email", {
        method: "POST",
      })
    );

    expect(response.status).toBe(403);
  });

  it("fails closed if BotID verification is unavailable", async () => {
    vi.mocked(checkBotId).mockRejectedValue(new Error("BotID unavailable"));

    const response = await auth.handler(
      new Request("https://patchsmith.io/api/auth/sign-up/email", {
        method: "POST",
      })
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "UNKNOWN_ERROR" });
  });

  it.each([
    "/get-session",
    "/callback/google",
    "/oauth-proxy-callback",
    "/api-key/verify",
  ])("does not challenge %s", async (path) => {
    const result = await authCaptcha.onRequest(
      new Request(`https://patchsmith.io/api/auth${path}`),
      await auth.$context
    );

    expect(result).toBeUndefined();
    expect(checkBotId).not.toHaveBeenCalled();
  });
});
