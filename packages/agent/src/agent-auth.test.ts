import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveAgentAuth } from "./agent-auth";

const mocks = vi.hoisted(() => {
  const env: Record<string, string> = {};

  return { env, oidc: vi.fn() };
});

vi.mock("#env", () => ({ env: mocks.env }));

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: mocks.oidc }));

beforeEach(() => {
  vi.resetAllMocks();

  for (const key of Object.keys(mocks.env)) {
    Reflect.deleteProperty(mocks.env, key);
  }
});

describe("agent model authentication", () => {
  it("resolves fresh runtime OIDC instead of caching module-level credentials", async () => {
    mocks.env.VERCEL_OIDC_TOKEN = "old-build-token";
    mocks.oidc
      .mockResolvedValueOnce("request-one")
      .mockResolvedValueOnce("request-two");
    await expect(resolveAgentAuth()).resolves.toMatchObject({
      VERCEL_OIDC_TOKEN: "request-one",
    });
    await expect(resolveAgentAuth()).resolves.toMatchObject({
      VERCEL_OIDC_TOKEN: "request-two",
    });
    expect(mocks.env.VERCEL_OIDC_TOKEN).toBe("old-build-token");
  });

  it("prefers an explicit Gateway key without looking up OIDC", async () => {
    mocks.env.AI_GATEWAY_API_KEY = "gateway-key";
    await expect(resolveAgentAuth()).resolves.toEqual(mocks.env);
    expect(mocks.oidc).not.toHaveBeenCalled();
  });

  it.each(["VERCEL_OIDC_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"])(
    "preserves configured %s outside a Vercel request",
    async (key) => {
      mocks.env[key] = "configured-key";
      mocks.oidc.mockRejectedValue(new Error("No request context"));
      await expect(resolveAgentAuth()).resolves.toEqual(mocks.env);
    }
  );

  it("fails without retrying when no model credentials are available", async () => {
    mocks.oidc.mockRejectedValue(new Error("No request context"));
    await expect(resolveAgentAuth()).rejects.toMatchObject({
      fatal: true,
    });
    await expect(resolveAgentAuth()).rejects.toThrow("Enable Vercel OIDC");
  });
});
