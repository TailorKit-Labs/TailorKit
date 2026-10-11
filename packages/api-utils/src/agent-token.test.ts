import { createHmac } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { issueAgentToken, verifyAgentToken } from "./agent-token";

const secret = "test-agent-secret-that-is-at-least-32-characters";
const url = "https://platform.test/api/platform";
const identity = {
  projectId: "project",
  appId: "app",
  cliTokenId: "cli",
  scope: {
    name: "user",
    value: { userId: "one" },
  },
};
afterEach(() => vi.useRealTimers());

it("issues a one-hour credential for the authorized app and initiating CLI identity", async () => {
  const jwt = await issueAgentToken(identity, secret, url);
  const claims = await verifyAgentToken(jwt, secret, url);
  expect(claims).toMatchObject({ ...identity, platformUrl: url, sub: "cli-token:cli" });
  expect(claims.exp - claims.iat).toBe(3600);
  expect(await issueAgentToken(identity, secret, url)).not.toBe(jwt);
  await expect(verifyAgentToken(jwt, secret + "wrong", url)).rejects.toThrow();
  await expect(verifyAgentToken(jwt, secret, url + "/other")).rejects.toThrow();
});

it("rejects expiry, including the exact one-hour boundary", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
  const jwt = await issueAgentToken(identity, secret, url);
  vi.advanceTimersByTime(3600_000);
  await expect(verifyAgentToken(jwt, secret, url)).rejects.toThrow();
});

it.each([
  { aud: "other" },
  { iss: "other" },
  { sub: "user:one" },
  { scope: null },
  { exp: Math.floor(Date.now() / 1000) + 7200 },
  { iat: Math.floor(Date.now() / 1000) + 60 },
])("rejects invalid signed claims %j", async (overrides) => {
  const claims = decodeJwt(await issueAgentToken(identity, secret, url));
  const jwt = await new SignJWT({ ...claims, ...overrides })
    .setProtectedHeader({ alg: "HS256", typ: "tailorkit-agent+jwt" })
    .sign(createHmac("sha256", secret).update("tailorkit-agent-deploy-v1").digest());
  await expect(verifyAgentToken(jwt, secret, url)).rejects.toThrow();
});

it.each([
  "http://platform.test/api/platform",
  "http://localhost.evil.test/api/platform",
  "http://192.168.1.1/api/platform",
])("refuses to issue JWTs for insecure destinations: %s", async (platformUrl) => {
  await expect(issueAgentToken(identity, secret, platformUrl)).rejects.toThrow(
    "Invalid agent platform URL",
  );
});

it.each([
  "http://localhost/api/platform",
  "http://127.0.0.1/api/platform",
  "http://[::1]/api/platform",
])("supports loopback development: %s", async (platformUrl) => {
  const jwt = await issueAgentToken(identity, secret, platformUrl);
  expect((await verifyAgentToken(jwt, secret, platformUrl)).platformUrl).toBe(platformUrl);
});
