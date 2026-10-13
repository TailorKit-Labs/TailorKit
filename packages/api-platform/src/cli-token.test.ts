import { hashSecret } from "@tailorkit/api-utils/hashing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { canonicalizeScope } from "./scope";

const require = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

// SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
interface TestAuthEnv {
  AUTH_SECRET: string | undefined;
}
const mocks = vi.hoisted(() => {
  const env: TestAuthEnv = { AUTH_SECRET: "test-cli-token-secret" };
  return { env, findToken: vi.fn() };
});
vi.mock("@tailorkit/db", () => ({
  db: { query: { cliToken: { findFirst: mocks.findToken } } },
}));
vi.mock("#env", () => ({ env: mocks.env }));
const { authenticateCli } = await import("./cli-token");
const canonical = canonicalizeScope({
  name: "org",
  value: { environment: "dev", tenant: "one" },
});

const validToken = () => ({
  expiresAt: new Date(Date.now() + 60_000),
  id: "cli-one",
  projectId: "project-one",
  revokedAt: null,
  scope: { name: "org", value: { environment: "dev", tenant: "one" } },
  scopeKey: canonical.scopeKey,
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T00:00:00Z"));
  mocks.env.AUTH_SECRET = "test-cli-token-secret";
  mocks.findToken.mockResolvedValue(validToken());
});
afterEach(() => vi.useRealTimers());

describe("shared platform CLI token authentication", () => {
  it("binds token lookup to the project and hashed credential and returns canonical scope", async () => {
    const token = await authenticateCli("project-one", "deploy-token");
    expect(mocks.findToken).toHaveBeenCalledWith({
      where: {
        projectId: "project-one",
        tokenHash: hashSecret("deploy-token", require(mocks.env.AUTH_SECRET)),
      },
    });
    expect(token).toEqual({
      ...validToken(),
      scope: canonical.scope,
      scopeKey: canonical.scopeKey,
    });
  });

  it.each([
    ["missing", undefined],
    ["revoked", { revokedAt: new Date() }],
    ["expired", { expiresAt: new Date(0) }],
    ["expires exactly now", { expiresAt: new Date("2026-10-06T00:00:00Z") }],
    ["malformed scope", { scope: { name: "org", value: {} } }],
    ["mismatched scope key", { scopeKey: "0".repeat(32) }],
  ])("rejects a %s token", async (_name, overrides) => {
    mocks.findToken.mockResolvedValueOnce(
      overrides ? { ...validToken(), ...overrides } : undefined
    );
    await expect(
      authenticateCli("project-one", "deploy-token")
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Invalid CLI deploy token.",
    });
  });

  it("rejects runtime credentials before reading tokens", async () => {
    await expect(
      authenticateCli("project-one", "deploy-token", true)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(mocks.findToken).not.toHaveBeenCalled();
  });

  it("reports missing auth configuration before reading tokens", async () => {
    mocks.env.AUTH_SECRET = undefined;
    await expect(
      authenticateCli("project-one", "deploy-token")
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(mocks.findToken).not.toHaveBeenCalled();
  });
});
