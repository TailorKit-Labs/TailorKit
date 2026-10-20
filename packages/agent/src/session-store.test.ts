import { readFile, readdir } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { appAgentLease, appAgentThread } from "@patchsmith/db/schema/apps";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { threadSandboxName } from "./identity";
import {
  cancelAppAgent,
  loadResumeStep,
  persistResumeStep,
  releaseSessionStep,
  renewSession,
} from "./session-store";
import { AppAgentThreadError, resolveAppAgentThread } from "./threads";

const mocks = vi.hoisted(() => ({
  db: vi.fn<() => ReturnType<typeof drizzle>>(),
  deleteSandbox: vi.fn(),
  runStatus:
    vi.fn<
      () => Promise<
        "pending" | "running" | "completed" | "failed" | "cancelled"
      >
    >(),
}));

vi.mock("@patchsmith/db", () => ({
  get db() {
    return mocks.db();
  },
}));

vi.mock("./sandbox", () => ({ deleteSandbox: mocks.deleteSandbox }));

vi.mock("workflow/api", () => ({
  getRun: () => ({
    get status() {
      return mocks.runStatus();
    },
  }),
}));

const appId = "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002";
const otherAppId = "dc0b71e8-8524-479f-b944-4590647e2af4";

const resumeFrom = {
  data: { sessionFileName: "native-1.jsonl" },
  harnessId: "pi",
  specificationVersion: "harness-v1" as const,
  type: "resume-session" as const,
};

const client = new PGlite();
const database = drizzle({ client });

beforeAll(async () => {
  // App identity is the fixture; both agent DDL changes come from Drizzle CLI.
  await client.exec("CREATE TABLE app (id uuid PRIMARY KEY)");
  const root = new URL("../../db/src/migrations/", import.meta.url);
  const migrations = await readdir(root);

  const names = migrations
    .filter(
      (entry) =>
        entry.endsWith("_app-agent-sessions") ||
        entry.endsWith("_agent-threads")
    )
    .toSorted();

  const changes = await Promise.all(
    names.map(
      async (name) =>
        await readFile(new URL(`${name}/migration.sql`, root), "utf-8")
    )
  );

  await Array.fromAsync(changes, async (migration) => {
    await client.exec(migration);
  });
  await client.query("INSERT INTO app (id) VALUES ($1), ($2)", [
    appId,
    otherAppId,
  ]);
});

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.runStatus.mockResolvedValue("running");
  mocks.db.mockReturnValue(database);
  // Keep the migrated schema, but isolate every test's leases and journals.
  await client.exec("TRUNCATE app_agent_lease, app_agent_thread");
});

afterAll(async () => {
  await client.close();
});

const lease = async () => {
  const [row] = await database
    .select()
    .from(appAgentLease)
    .where(eq(appAgentLease.appId, appId));

  return row;
};

const thread = async (id: string) => {
  const [row] = await database
    .select()
    .from(appAgentThread)
    .where(eq(appAgentThread.id, id));

  return row;
};

const complete = async (id: string, runId: string) => {
  await loadResumeStep(appId, id, runId);
  await persistResumeStep(appId, id, runId, resumeFrom, threadSandboxName(id));
  await releaseSessionStep(appId, runId);
};

describe("agent threads and app workspace leases (Postgres)", () => {
  it.each(["failed", "cancelled", "completed"] as const)(
    "recovers a %s workflow's unexpired lease without trusting its journal",
    async (status) => {
      const first = await resolveAppAgentThread(appId);
      const second = await resolveAppAgentThread(appId);
      await loadResumeStep(appId, first, "run-a");
      mocks.runStatus.mockResolvedValue(status);
      await expect(
        loadResumeStep(appId, second, "run-b")
      ).resolves.toMatchObject({
        cleanupSandboxName: threadSandboxName(first),
      });
      expect(await lease()).toMatchObject({
        activeRunId: "run-b",
        activeThreadId: second,
      });
      const abandoned = await thread(first);
      expect(abandoned?.invalidatedAt).toBeInstanceOf(Date);
      expect(abandoned?.resumeState).toBeNull();
      await expect(renewSession(appId, "run-a")).rejects.toThrow(
        "no longer owns"
      );
    }
  );

  it("keeps ownership when the previous run's status cannot be verified", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    await loadResumeStep(appId, first, "run-a");
    mocks.runStatus.mockRejectedValue(new Error("Status unavailable"));
    await expect(loadResumeStep(appId, second, "run-b")).rejects.toThrow(
      "Status unavailable"
    );
    expect(await lease()).toMatchObject({ activeRunId: "run-a" });
    expect(await thread(first)).toMatchObject({ invalidatedAt: null });
  });

  it("rolls back a timed-out status lookup and ignores its late result", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    await loadResumeStep(appId, first, "run-a");
    await persistResumeStep(
      appId,
      first,
      "run-a",
      resumeFrom,
      threadSandboxName(first)
    );
    const savedLease = await lease();
    const savedThread = await thread(first);
    const otherThread = await thread(second);
    const status = Promise.withResolvers<"completed">();
    mocks.runStatus.mockReturnValueOnce(status.promise);
    vi.useFakeTimers();

    try {
      const pending = loadResumeStep(appId, second, "run-b");

      const rejected = expect(pending).rejects.toThrow(
        "Timed out checking the active app agent workflow."
      );

      await vi.waitFor(() => {
        expect(mocks.runStatus).toHaveBeenCalledOnce();
      });
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }

    expect(await lease()).toEqual(savedLease);
    expect(await thread(first)).toEqual(savedThread);
    expect(await thread(second)).toEqual(otherThread);
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
    status.resolve("completed");
    expect(await lease()).toEqual(savedLease);
  });
  it.each(["", "not-a-uuid", `${appId}-suffix`])(
    "rejects malformed thread ID %j before accessing the database",
    async (threadId) => {
      await expect(
        resolveAppAgentThread(appId, threadId)
      ).rejects.toBeInstanceOf(AppAgentThreadError);
      expect(mocks.db).not.toHaveBeenCalled();
    }
  );

  it("creates independent threads by default and resumes only an explicit existing ID", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    expect(second).not.toBe(first);
    await expect(resolveAppAgentThread(appId, first)).resolves.toBe(first);
    await expect(resolveAppAgentThread(otherAppId, first)).rejects.toThrow(
      "Thread not found"
    );
    await expect(
      resolveAppAgentThread(appId, "56f50b46-cc17-43ae-a04b-6a8c32a4c788")
    ).rejects.toThrow("Thread not found");
  });

  it("atomically admits one writer even when the requests use different threads", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);

    const results = await Promise.allSettled([
      loadResumeStep(appId, first, "run-a"),
      loadResumeStep(appId, second, "run-b"),
    ]);

    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1
    );
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(
      1
    );
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("keeps each thread's resume state when switching conversations on one app", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    await complete(first, "run-a");
    const fresh = await loadResumeStep(appId, second, "run-b");
    expect(fresh.resumeFrom).toBeUndefined();
    await persistResumeStep(
      appId,
      second,
      "run-b",
      { ...resumeFrom, data: { sessionFileName: "native-2.jsonl" } },
      threadSandboxName(second)
    );
    await releaseSessionStep(appId, "run-b");
    await expect(loadResumeStep(appId, first, "run-c")).resolves.toMatchObject({
      resumeFrom,
      sandboxName: threadSandboxName(first),
    });
    expect(await thread(second)).toMatchObject({
      resumeState: JSON.stringify({
        ...resumeFrom,
        data: { sessionFileName: "native-2.jsonl" },
      }),
    });
  });

  it("reclaims its own lease on step retry without resetting the conversation", async () => {
    const id = await resolveAppAgentThread(appId);
    await loadResumeStep(appId, id, "run-a");
    await expect(loadResumeStep(appId, id, "run-a")).resolves.toMatchObject({
      resumeFrom: undefined,
    });
    expect(await lease()).toMatchObject({
      activeRunId: "run-a",
      activeThreadId: id,
    });
  });

  it("rejects unknown and foreign threads before claiming the workspace", async () => {
    const foreign = await resolveAppAgentThread(otherAppId);
    await expect(loadResumeStep(appId, foreign, "run-a")).rejects.toThrow(
      "Thread not found"
    );
    expect(await lease()).toBeUndefined();
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("prevents another run or conversation from changing the owning lease and journal", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    await loadResumeStep(appId, first, "run-a");
    await expect(
      persistResumeStep(appId, first, "run-b", resumeFrom, "foreign")
    ).rejects.toThrow("another editing turn");
    await expect(
      persistResumeStep(appId, second, "run-a", resumeFrom, "foreign")
    ).rejects.toThrow("another editing turn");
    await expect(renewSession(appId, "run-b")).rejects.toThrow(
      "no longer owns"
    );
    await releaseSessionStep(appId, "run-b");
    await cancelAppAgent(appId, "run-b");
    expect(await lease()).toMatchObject({ activeRunId: "run-a" });
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("cancels only the active thread and preserves other saved conversations", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    await complete(first, "run-a");
    await loadResumeStep(appId, second, "run-b");
    mocks.deleteSandbox.mockImplementation(async () => {
      expect(await lease()).toMatchObject({ activeRunId: "run-b" });
    });
    await cancelAppAgent(appId, "run-b");
    expect(mocks.deleteSandbox).toHaveBeenCalledExactlyOnceWith(
      threadSandboxName(second)
    );
    await expect(resolveAppAgentThread(appId, second)).rejects.toThrow(
      "no longer resumable"
    );
    await expect(loadResumeStep(appId, first, "run-c")).resolves.toMatchObject({
      resumeFrom,
    });
  });

  it("retains the lease when sandbox cleanup fails", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    await loadResumeStep(appId, first, "run-a");
    mocks.deleteSandbox.mockRejectedValueOnce(new Error("Cleanup unavailable"));
    await expect(cancelAppAgent(appId, "run-a")).rejects.toThrow(
      "Cleanup unavailable"
    );
    await expect(loadResumeStep(appId, second, "run-b")).rejects.toThrow(
      "already being edited"
    );
  });

  it("recovers an abandoned writer without losing other threads or cleanup state on retry", async () => {
    const first = await resolveAppAgentThread(appId);
    const second = await resolveAppAgentThread(appId);
    const third = await resolveAppAgentThread(appId);
    await complete(third, "run-saved");
    await loadResumeStep(appId, first, "run-a");
    await database
      .update(appAgentLease)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(appAgentLease.appId, appId));
    await expect(loadResumeStep(appId, first, "run-b")).rejects.toThrow(
      "no longer resumable"
    );
    const saved = await loadResumeStep(appId, second, "run-b");
    expect(saved).toMatchObject({
      cleanupSandboxName: threadSandboxName(first),
      resumeFrom: undefined,
    });
    await expect(loadResumeStep(appId, second, "run-b")).resolves.toEqual(
      saved
    );
    await expect(resolveAppAgentThread(appId, first)).rejects.toThrow(
      "no longer resumable"
    );
    expect(await thread(third)).toMatchObject({
      resumeState: JSON.stringify(resumeFrom),
    });
  });
});
