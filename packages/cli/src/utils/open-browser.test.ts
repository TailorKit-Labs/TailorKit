import { ChildProcess, spawn } from "node:child_process";
import type * as childProcess from "node:child_process";
import { platform } from "node:os";
import type * as nodeOs from "node:os";

import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { openUrlInBrowser } from "./open-browser";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof childProcess>()),
  spawn: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof nodeOs>()),
  platform: vi.fn(),
}));

const createChildProcess = () => {
  const child = new ChildProcess();
  const unref = vi.spyOn(child, "unref").mockImplementation(() => {});
  return { child, unref };
};

describe("openUrlInBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(platform).mockReturnValue("darwin");
  });

  it("opens URLs with the platform browser command", async () => {
    const { child, unref } = createChildProcess();

    vi.mocked(spawn).mockReturnValue(child);

    const result = openUrlInBrowser("https://example.com/approve");
    child.emit("spawn");

    await expect(result).resolves.toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "open",
      ["https://example.com/approve"],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }
    );
    expect(unref).toHaveBeenCalledOnce();
  });

  it("returns false when the browser command cannot start", async () => {
    const { child, unref } = createChildProcess();

    vi.mocked(spawn).mockReturnValue(child);

    const result = openUrlInBrowser("https://example.com/approve");
    child.emit("error", new Error("missing opener"));

    await expect(result).resolves.toBe(false);
    expect(unref).not.toHaveBeenCalled();
  });
});
