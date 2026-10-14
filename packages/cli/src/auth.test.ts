import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import type * as nodeOs from "node:os";
import path from "node:path";

import { createTailorKitClient } from "@tailorkit/core/server";
import { loadTailorKitConfig } from "@tailorkit/vite/config/loader";
import { SignJWT } from "jose";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { z } from "zod";

vi.mock("@tailorkit/vite/config/loader", () => ({
  loadTailorKitConfig: vi.fn(),
}));

vi.mock("@tailorkit/core/server", () => ({
  createTailorKitClient: vi.fn(),
}));

const temporaryDirectories: string[] = [];

const createTemporaryHome = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "tailorkit-auth-"));
  temporaryDirectories.push(directory);
  return directory;
};

const loadAuthModule = async (homeDirectory: string) => {
  vi.resetModules();
  vi.doMock("node:os", async (importOriginal) => ({
    ...(await importOriginal<typeof nodeOs>()),
    homedir: () => homeDirectory,
  }));

  return await import("./auth");
};

const authStorePath = (homeDirectory: string) =>
  path.join(homeDirectory, ".tailorkit", "auth.json");

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This fixture must represent malformed input so the runtime validation boundary can be tested.
const writeAuthStoreFixture = async (homeDirectory: string, value: unknown) => {
  const filePath = authStorePath(homeDirectory);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value));
  return filePath;
};

describe("auth store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.doUnmock("node:os");

    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, { force: true, recursive: true });
      })
    );
  });

  it("stores and reads deploy tokens by host", async () => {
    const homeDirectory = await createTemporaryHome();
    const { getDeployToken, saveDeployToken } =
      await loadAuthModule(homeDirectory);

    await saveDeployToken("https://example.com", {
      deployToken: "deploy-token",
      scope: { name: "user", value: { userId: "user-1" } },
    });

    await expect(getDeployToken("https://example.com")).resolves.toEqual({
      deployToken: "deploy-token",
      scope: { name: "user", value: { userId: "user-1" } },
    });
  });

  it("validates auth.json before returning stored credentials", async () => {
    const homeDirectory = await createTemporaryHome();
    await writeAuthStoreFixture(homeDirectory, {
      hosts: { "https://example.com": {} },
    });
    const { getDeployToken } = await loadAuthModule(homeDirectory);

    await expect(getDeployToken("https://example.com")).rejects.toThrow();
  });

  it("keeps legacy tokens readable while discarding their unnamed scope", async () => {
    const homeDirectory = await createTemporaryHome();
    await writeAuthStoreFixture(homeDirectory, {
      hosts: {
        "https://example.com": {
          deployToken: "deploy-token",
          scope: { userId: "user-1" },
        },
      },
    });
    const { getDeployToken } = await loadAuthModule(homeDirectory);

    await expect(getDeployToken("https://example.com")).resolves.toEqual({
      deployToken: "deploy-token",
      scope: undefined,
    });
  });

  it("preserves unknown top-level auth.json keys when saving a host token", async () => {
    const homeDirectory = await createTemporaryHome();
    const filePath = await writeAuthStoreFixture(homeDirectory, {
      futureKey: { value: true },
      hosts: {
        "https://existing.example.com": {
          deployToken: "existing-token",
        },
      },
    });
    const { saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://new.example.com", {
      deployToken: "new-token",
      scope: { name: "user", value: { userId: "user-1" } },
    });

    await expect(readFile(filePath, "utf-8").then(JSON.parse)).resolves.toEqual(
      {
        futureKey: { value: true },
        hosts: {
          "https://existing.example.com": {
            deployToken: "existing-token",
          },
          "https://new.example.com": {
            deployToken: "new-token",
            scope: { name: "user", value: { userId: "user-1" } },
          },
        },
      }
    );
  });

  it("writes auth.json with user-only permissions", async () => {
    const homeDirectory = await createTemporaryHome();
    const { saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://example.com", {
      deployToken: "deploy-token",
      scope: { name: "user", value: { userId: "user-1" } },
    });

    const fileStat = await stat(authStorePath(homeDirectory));
    expect(fileStat.mode % 0o1000).toBe(0o600);
  });

  it("tightens permissions on an existing auth.json file", async () => {
    const homeDirectory = await createTemporaryHome();
    const filePath = await writeAuthStoreFixture(homeDirectory, { hosts: {} });
    await chmod(filePath, 0o644);
    const { saveDeployToken } = await loadAuthModule(homeDirectory);

    await saveDeployToken("https://example.com", {
      deployToken: "deploy-token",
      scope: { name: "user", value: { userId: "user-1" } },
    });

    const fileStat = await stat(filePath);
    expect(fileStat.mode % 0o1000).toBe(0o600);
  });

  it("resolves the host URL from tailorkit.config.ts", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com///" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    const { resolveHostUrl } = await loadAuthModule(homeDirectory);

    await expect(resolveHostUrl({ cwd: homeDirectory })).resolves.toBe(
      "https://example.com"
    );
    expect(loadTailorKitConfig).toHaveBeenCalledWith(undefined, homeDirectory);
  });

  it("creates a browser approval URL from the host API URL", async () => {
    const homeDirectory = await createTemporaryHome();
    const { createCliAuthApprovalUrl } = await loadAuthModule(homeDirectory);

    expect(
      createCliAuthApprovalUrl(
        "https://example.com/api/tailorkit",
        "ABC-123-XYZ"
      )
    ).toBe(
      "https://example.com/api/tailorkit/cli-auth/approve?code=ABC-123-XYZ"
    );
  });

  it("resolves an explicit host without loading config", async () => {
    const homeDirectory = await createTemporaryHome();
    const { resolveHostUrl } = await loadAuthModule(homeDirectory);

    await expect(
      resolveHostUrl({
        configPath: "missing.config.ts",
        cwd: homeDirectory,
        host: "https://example.com/api/tailorkit///?unused=true#fragment",
      })
    ).resolves.toBe("https://example.com/api/tailorkit");
    expect(loadTailorKitConfig).not.toHaveBeenCalled();
  });

  it.each(["", "localhost:3000", "ftp://example.com"])(
    "rejects invalid explicit host %s without falling back to config",
    async (host) => {
      const homeDirectory = await createTemporaryHome();
      const { resolveHostUrl } = await loadAuthModule(homeDirectory);

      await expect(
        resolveHostUrl({ cwd: homeDirectory, host })
      ).rejects.toThrow("host URL");
      expect(loadTailorKitConfig).not.toHaveBeenCalled();
    }
  );

  it("logs in, verifies credentials, and logs out using an explicit host without config", async () => {
    vi.useFakeTimers();
    const homeDirectory = await createTemporaryHome();
    const hostUrl = "https://example.com/api/tailorkit";
    const scope = { name: "user", value: { userId: "user-1" } };
    const start = vi.fn().mockResolvedValue({
      deviceCode: "device-code",
      expiresAt: new Date(Date.now() + 60_000),
      userCode: "ABC-123",
    });
    const poll = vi.fn().mockResolvedValue({
      deployToken: "deploy-token",
      scope,
      status: "approved",
    });
    const verifyToken = vi.fn().mockResolvedValue({ scope });
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

    vi.mocked(createTailorKitClient).mockReturnValue(
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
      {
        cliAuth: { poll, start, verifyToken },
      } as unknown as ReturnType<typeof createTailorKitClient>
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
    );
    const { runLogin, runWhoami, runLogout, getDeployToken } =
      await loadAuthModule(homeDirectory);
    const onUserCode = vi.fn<Parameters<typeof runLogin>[1]>();
    const options = { cwd: homeDirectory, host: `${hostUrl}/` };
    const login = runLogin(options, onUserCode);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(login).resolves.toEqual({ hostUrl, scope });
    expect(onUserCode).toHaveBeenCalledWith(
      expect.objectContaining({ hostUrl, userCode: "ABC-123" })
    );
    expect(poll).toHaveBeenCalledWith({ deviceCode: "device-code" });
    await expect(runWhoami(options)).resolves.toEqual({ hostUrl, scope });
    expect(createTailorKitClient).toHaveBeenLastCalledWith({
      headers: { authorization: "Bearer deploy-token" },
      url: hostUrl,
    });
    await expect(runLogout(options)).resolves.toEqual({
      hostUrl,
      removed: true,
    });
    await expect(getDeployToken(hostUrl)).resolves.toBeUndefined();
    expect(loadTailorKitConfig).not.toHaveBeenCalled();
  });

  it("identifies missing host credentials as not logged in", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    const { NotLoggedInError, runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBeInstanceOf(
      NotLoggedInError
    );
  });

  it("treats unauthorized token verification as not logged in", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

    vi.mocked(createTailorKitClient).mockReturnValue(
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
      {
        cliAuth: {
          verifyToken: vi.fn().mockResolvedValue({
            data: undefined,
            error: { code: "UNAUTHORIZED", message: "token expired" },
          }),
        },
      } as unknown as ReturnType<typeof createTailorKitClient>
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
    );
    await writeAuthStoreFixture(homeDirectory, {
      hosts: {
        "https://example.com": {
          deployToken: "expired-token",
        },
      },
    });
    const { NotLoggedInError, runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBeInstanceOf(
      NotLoggedInError
    );
    await expect(runWhoami({ cwd: homeDirectory })).rejects.toThrow(
      "Not logged in for https://example.com. Run tailorkit login --host https://example.com."
    );
  });

  it.each([
    {
      error: new TypeError("fetch failed"),
      label: "network rejection",
      rejected: true,
    },
    {
      error: { code: "INTERNAL_SERVER_ERROR", message: "Service unavailable" },
      label: "server RPC error",
      rejected: false,
    },
    {
      error: { code: "FORBIDDEN" },
      label: "forbidden rejection",
      rejected: true,
    },
    {
      error: new Error("Unexpected response"),
      label: "uncoded RPC error",
      rejected: false,
    },
    { error: "Connection closed", label: "string rejection", rejected: true },
    { error: null, label: "null rejection", rejected: true },
  ])("preserves $label unchanged", async ({ error, rejected }) => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    const verifyToken = vi.fn();
    if (rejected) {
      verifyToken.mockRejectedValue(error);
    } else {
      verifyToken.mockResolvedValue({ error });
    }
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

    vi.mocked(createTailorKitClient).mockReturnValue(
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
      {
        cliAuth: { verifyToken },
      } as unknown as ReturnType<typeof createTailorKitClient>
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
    );
    const fixture = {
      hosts: { "https://example.com": { deployToken: "deploy-token" } },
    };
    const filePath = await writeAuthStoreFixture(homeDirectory, fixture);
    const { runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBe(error);
    await expect(readFile(filePath, "utf-8").then(JSON.parse)).resolves.toEqual(
      fixture
    );
  });

  it("returns the verified named scope", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

    vi.mocked(createTailorKitClient).mockReturnValue(
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
      {
        cliAuth: {
          verifyToken: vi.fn().mockResolvedValue({
            data: {
              scope: {
                name: "organization",
                value: { orgId: "org-1", userId: "user-1" },
              },
            },
          }),
        },
      } as unknown as ReturnType<typeof createTailorKitClient>
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
    );
    await writeAuthStoreFixture(homeDirectory, {
      hosts: { "https://example.com": { deployToken: "deploy-token" } },
    });
    const { runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).resolves.toEqual({
      hostUrl: "https://example.com",
      scope: {
        name: "organization",
        value: { orgId: "org-1", userId: "user-1" },
      },
    });
  });

  it("rejects a legacy verification response before changing stored auth", async () => {
    const homeDirectory = await createTemporaryHome();
    vi.mocked(loadTailorKitConfig).mockResolvedValue({
      config: { host: "https://example.com" },
      filepath: path.join(homeDirectory, "tailorkit.config.ts"),
      root: homeDirectory,
    });
    // SAFETY: This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary.

    vi.mocked(createTailorKitClient).mockReturnValue(
      /* oxlint-disable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This test supplies a deliberately invalid value or a minimal platform double to exercise the runtime boundary. */
      {
        cliAuth: {
          verifyToken: vi
            .fn()
            .mockResolvedValue({ data: { scopeId: "legacy-scope" } }),
        },
      } as unknown as ReturnType<typeof createTailorKitClient>
      /* oxlint-enable typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions */
    );
    const filePath = await writeAuthStoreFixture(homeDirectory, {
      hosts: { "https://example.com": { deployToken: "deploy-token" } },
    });
    const { runWhoami } = await loadAuthModule(homeDirectory);

    await expect(runWhoami({ cwd: homeDirectory })).rejects.toBeInstanceOf(
      z.ZodError
    );
    await expect(readFile(filePath, "utf-8").then(JSON.parse)).resolves.toEqual(
      {
        hosts: { "https://example.com": { deployToken: "deploy-token" } },
      }
    );
  });

  it("JWT login and whoami use platform verification without reading or modifying stored sessions", async () => {
    const home = await createTemporaryHome();
    const now = Math.floor(Date.now() / 1000);
    const scope = { name: "user", value: { userId: "one" } };
    const jwt = await new SignJWT({
      appId: "app",
      aud: "tailorkit-platform-cli",
      exp: now + 3600,
      iat: now,
      iss: "tailorkit-agent",
      platformUrl: "https://platform.test/api/platform",
      projectId: "project",
      scope,
    })
      .setProtectedHeader({ alg: "HS256", typ: "tailorkit-agent+jwt" })
      .sign(new TextEncoder().encode("test-only-signing-secret"));
    vi.stubEnv("TAILORKIT_AGENT_TOKEN", jwt);
    const stored = await writeAuthStoreFixture(home, {
      hosts: { "http://localhost:1": { deployToken: "existing-token" } },
    });
    const original = await readFile(stored, "utf-8");
    const { runLogin, runWhoami, runLogout } = await loadAuthModule(home);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (!(input instanceof Request)) {
          throw new Error("Expected a Request.");
        }
        const request = input;
        expect(request.url).toBe(
          "https://platform.test/api/platform/cli-auth/verify-token"
        );
        expect(request.headers.get("authorization")).toBe(`Bearer ${jwt}`);
        expect(await request.json()).toEqual({ deployToken: jwt });
        return Response.json({ scope });
      });
    const onCode = vi.fn<Parameters<typeof runLogin>[1]>();
    expect(await runLogin({ host: "http://localhost:1" }, onCode)).toEqual({
      hostUrl: "https://platform.test/api/platform",
      scope,
    });
    expect(onCode).not.toHaveBeenCalled();
    await runWhoami({ host: "http://localhost:1" });
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValueOnce(
      Response.json(
        {
          code: "SERVICE_UNAVAILABLE",
          message: "Platform is temporarily unavailable.",
        },
        { status: 503 }
      )
    );
    await expect(
      runWhoami({ host: "http://localhost:1" })
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(onCode).not.toHaveBeenCalled();
    expect(await runLogout({ host: "http://localhost:1" })).toMatchObject({
      removed: false,
    });
    expect(await readFile(stored, "utf-8")).toBe(original);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
});
