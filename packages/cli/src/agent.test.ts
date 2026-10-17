/* oxlint-disable typescript/no-unsafe-member-access, typescript/no-unsafe-assignment, typescript/no-unsafe-call -- This integration fixture loads workspace or generated modules dynamically and supplies minimal platform doubles; its assertions validate the observed runtime contract. */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import type * as authModule from "./auth";

const isSymbolValue = <TValue>(value: TValue): value is TValue & symbol =>
  typeof value === "symbol";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  client: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  info: vi.fn(),
  list: vi.fn(),
  load: vi.fn(),
  select: vi.fn(),
  text: vi.fn(),
  token: vi.fn(),
  tui: vi.fn(),
  whoami: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({
  autocomplete: mocks.select,
  cancel: mocks.cancel,
  isCancel: (value: unknown): value is symbol => isSymbolValue(value),
  log: { info: mocks.info },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  text: mocks.text,
}));
vi.mock("@tailorkit/vite/config/loader", () => ({
  loadTailorKitConfig: mocks.load,
}));
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof authModule>()),
  getDeployToken: mocks.token,
  runWhoami: mocks.whoami,
}));
vi.mock("@tailorkit/core/server", () => ({
  createTailorKitClient: mocks.client,
}));
vi.mock("./agent-tui", () => ({ openAgentTui: mocks.tui }));
const { runAgentCommand } = await import("./agent");
const { NotLoggedInError } = await import("./auth");
const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
let root: string;
let configPath: string;
const host = "https://host.test/api/tailorkit";

beforeEach(async () => {
  vi.resetAllMocks();
  root = await mkdtemp(path.join(tmpdir(), "tailorkit-agent-"));
  configPath = path.join(root, "tailorkit.config.ts");
  vi.spyOn(process, "cwd").mockReturnValue(root);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "my-app" })
  );
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: true,
  });
  mocks.load.mockRejectedValue(new Error("Config must not be loaded"));
  mocks.whoami.mockResolvedValue({});
  mocks.token.mockResolvedValue({ deployToken: "cli-token" });
  mocks.client.mockReturnValue({
    appAgent: { chat: vi.fn(), create: mocks.create },
    apps: { get: mocks.get, list: mocks.list },
  });
  mocks.list.mockResolvedValue({ items: [], pagination: { hasMore: false } });
  mocks.get.mockResolvedValue({ createdByAgent: true });
  mocks.create.mockResolvedValue({ id: "new-app" });
  mocks.select.mockResolvedValue(null);
  mocks.text.mockResolvedValue("my-app");
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Vitest requires the resolved value argument.
  mocks.tui.mockResolvedValue(undefined);
});
afterEach(async () => {
  expect(mocks.load).not.toHaveBeenCalled();
  await rm(root, { force: true, recursive: true });
  vi.restoreAllMocks();
  for (const [object, key, descriptor] of [
    [process.stdin, "isTTY", stdinTty],
    [process.stdout, "isTTY", stdoutTty],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(object, key, descriptor);
    } else {
      Reflect.deleteProperty(object, key);
    }
  }
});

describe("agent command", () => {
  it("opens an explicit app from an empty directory using normalized host credentials", async () => {
    await rm(path.join(root, "package.json"));
    await runAgentCommand({ appId: "app-one", host: `${host}///` });
    expect(mocks.client).toHaveBeenCalledWith({
      headers: { authorization: "Bearer cli-token" },
      url: host,
    });
    expect(mocks.token).toHaveBeenCalledWith(host);
    expect(requireValue(mocks.tui.mock.lastCall)[0].appId).toBe("app-one");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.get).toHaveBeenCalledWith({ appId: "app-one" });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });
  it("forwards an explicit conversation ID to the TUI", async () => {
    const threadId = "e773a870-df5a-4bea-9ebd-9be4c0b1897a";
    await runAgentCommand({ appId: "app-one", host, threadId });
    expect(requireValue(mocks.tui.mock.lastCall)[0].threadId).toBe(threadId);
  });

  it("ignores an existing config when choosing an app", async () => {
    const source =
      'export default { name: "Test App", slug: "test-app", host: "https://other.test", appId: "other-app" };\n';
    await writeFile(configPath, source);
    mocks.select.mockResolvedValueOnce("selected-app");
    await runAgentCommand({ host });
    expect(requireValue(mocks.tui.mock.lastCall)[0].appId).toBe("selected-app");
    expect(await readFile(configPath, "utf-8")).toBe(source);
  });
  it("requires --host even when a config exists", async () => {
    await writeFile(
      configPath,
      'export default { name: "Test App", slug: "test-app", host: "https://other.test" };\n'
    );
    await expect(runAgentCommand({})).rejects.toThrow("--host <url>");
    expect(mocks.whoami).not.toHaveBeenCalled();
  });
  it.each(["", "   ", "localhost:3000", "ftp://host.test"])(
    "rejects invalid host %s before authenticating",
    async (invalidHost) => {
      await expect(runAgentCommand({ host: invalidHost })).rejects.toThrow(
        "host URL"
      );
      expect(mocks.whoami).not.toHaveBeenCalled();
    }
  );
  it("lists AI-created apps across every page, searches by name or ID, and opens the selected app", async () => {
    mocks.list
      .mockResolvedValueOnce({
        items: [
          {
            createdByAgent: false,
            id: "manual",
            name: "Manual app",
            shortId: "manual",
          },
          {
            createdByAgent: true,
            id: "app-one",
            name: "First app",
            shortId: "one",
          },
        ],
        pagination: { hasMore: true },
      })
      .mockResolvedValueOnce({
        items: [
          {
            createdByAgent: true,
            id: "app-two",
            name: "Second app",
            shortId: "two",
          },
        ],
        pagination: { hasMore: false },
      });
    mocks.select.mockResolvedValueOnce("app-two");
    await runAgentCommand({ host });
    expect(mocks.whoami).toHaveBeenCalledOnce();
    expect(mocks.list.mock.calls).toEqual([
      [{ page: 1, pageSize: 100 }],
      [{ page: 2, pageSize: 100 }],
    ]);
    const [prompt] = requireValue(mocks.select.mock.lastCall);
    expect(prompt.options).toEqual([
      { hint: "one", label: "First app", value: "app-one" },
      { hint: "two", label: "Second app", value: "app-two" },
      { label: "Create a new app", value: null },
    ]);
    expect(prompt.filter("SECOND", prompt.options[1])).toBe(true);
    expect(prompt.filter("two", prompt.options[1])).toBe(true);
    expect(prompt.filter("app-two", prompt.options[1])).toBe(true);
    expect(prompt.filter("missing", prompt.options[1])).toBe(false);
    expect(prompt.filter("missing", prompt.options[2])).toBe(true);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(requireValue(mocks.tui.mock.lastCall)[0].appId).toBe("app-two");
  });
  it("creates a named app when none exist without writing config", async () => {
    mocks.text.mockResolvedValueOnce("  New app  ");
    await runAgentCommand({ host });
    expect(mocks.text).toHaveBeenCalledWith(
      expect.objectContaining({ initialValue: "My app" })
    );
    const [{ validate }] = requireValue(mocks.text.mock.lastCall);
    expect(validate("  ")).toBe("Enter an app name.");
    expect(validate("New app")).toBeUndefined();
    expect(mocks.create).toHaveBeenCalledWith({
      description: null,
      name: "New app",
    });
    expect(await readdir(root)).toEqual(["package.json"]);
    expect(mocks.info).toHaveBeenCalledWith("App: new-app");
    expect(requireValue(mocks.tui.mock.lastCall)[0].appId).toBe("new-app");
  });
  it("offers creation even when existing apps are available", async () => {
    mocks.list.mockResolvedValueOnce({
      items: [
        {
          createdByAgent: true,
          id: "existing",
          name: "Existing app",
          shortId: "existing-public",
        },
      ],
      pagination: { hasMore: false },
    });
    await runAgentCommand({ host });
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(requireValue(mocks.tui.mock.lastCall)[0].appId).toBe("new-app");
  });
  it("only offers creation when all existing apps were created manually", async () => {
    mocks.list.mockResolvedValueOnce({
      items: [
        {
          createdByAgent: false,
          id: "manual",
          name: "Manual app",
          shortId: "manual",
        },
      ],
      pagination: { hasMore: false },
    });
    await runAgentCommand({ host });
    expect(requireValue(mocks.select.mock.lastCall)[0].options).toEqual([
      { label: "Create a new app", value: null },
    ]);
  });
  it.each([false, undefined])(
    "rejects an explicit app with createdByAgent=%s",
    async (createdByAgent) => {
      mocks.get.mockResolvedValueOnce({ createdByAgent });
      await expect(runAgentCommand({ appId: "manual", host })).rejects.toThrow(
        "The agent can only edit apps created by AI"
      );
      expect(mocks.tui).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    }
  );
  it("does not open the agent when an explicit app lookup fails", async () => {
    mocks.get.mockRejectedValueOnce(new Error("App not found"));
    await expect(runAgentCommand({ appId: "missing", host })).rejects.toThrow(
      "App not found"
    );
    expect(mocks.tui).not.toHaveBeenCalled();
  });
  it.each(["select", "text"] as const)(
    "cancels at the %s prompt without creating an app",
    async (prompt) => {
      mocks[prompt].mockResolvedValueOnce(Symbol("cancel"));
      await runAgentCommand({ host });
      expect(mocks.cancel).toHaveBeenCalledWith("Agent cancelled.");
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.tui).not.toHaveBeenCalled();
    }
  );
  it.each(["list", "create"] as const)(
    "stops on a %s API failure without opening the agent",
    async (endpoint) => {
      mocks[endpoint].mockRejectedValueOnce(new Error("Host unavailable"));
      await expect(runAgentCommand({ host })).rejects.toThrow(
        "Host unavailable"
      );
      expect(mocks.tui).not.toHaveBeenCalled();
    }
  );
  it("propagates renderer failure", async () => {
    mocks.tui.mockRejectedValueOnce(new Error("Renderer failed"));
    await expect(runAgentCommand({ host })).rejects.toThrow("Renderer failed");
  });
  it("starts login when necessary and verifies approval before opening the TUI", async () => {
    mocks.whoami.mockRejectedValueOnce(new NotLoggedInError("host"));
    const login = vi.fn().mockResolvedValue({});
    // oxlint-disable-next-line require-await -- The mock or negative type case must retain the asynchronous API contract.
    mocks.list.mockImplementationOnce(async () => {
      expect(login).toHaveBeenCalledOnce();
      expect(mocks.whoami).toHaveBeenCalledTimes(2);
      return { items: [], pagination: { hasMore: false } };
    });
    await runAgentCommand({ host, onLoginRequired: login });
    expect(login).toHaveBeenCalledOnce();
    expect(mocks.whoami).toHaveBeenCalledTimes(2);
    expect(mocks.whoami).toHaveBeenCalledWith(
      expect.objectContaining({ host })
    );
    expect(mocks.tui).toHaveBeenCalledOnce();
  });
  it("does not open a session when authentication fails", async () => {
    mocks.whoami.mockRejectedValueOnce(new Error("Host unavailable"));
    await expect(runAgentCommand({ host })).rejects.toThrow("Host unavailable");
    expect(mocks.tui).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects non-interactive use before authenticating", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: false,
    });
    await expect(runAgentCommand({ host })).rejects.toThrow(
      "interactive terminal"
    );
    expect(mocks.whoami).not.toHaveBeenCalled();
  });
});
