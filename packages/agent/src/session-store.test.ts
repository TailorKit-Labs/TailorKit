import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { appAgentSession } from "@tailorkit/db/schema/apps";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import {
  cancelAppAgent,
  loadResumeStep,
  persistResumeStep,
  releaseSessionStep,
  renewSession,
} from "./session-store";

const mocks = vi.hoisted(() => ({
  db: vi.fn<() => ReturnType<typeof drizzle>>(),
  deleteSandbox: vi.fn(),
}));
vi.mock("@tailorkit/db", () => ({
  get db() {
    return mocks.db();
  },
}));
vi.mock("./sandbox", () => ({ deleteSandbox: mocks.deleteSandbox }));

const appId = "a3e7568a-c4f7-4ac0-8c35-71ff0f4cd002";
const resumeFrom = {
  data: { sessionFileName: "native-1.jsonl" },
  harnessId: "pi",
  specificationVersion: "harness-v1" as const,
  type: "resume-session" as const,
};
let client: PGlite;
let database: ReturnType<typeof drizzle>;

beforeEach(async () => {
  vi.resetAllMocks();
  client = new PGlite();
  database = drizzle({ client });
  mocks.db.mockReturnValue(database);
  // The fixture only needs app identity; session DDL is the generated migration.
  await client.exec("CREATE TABLE app (id uuid PRIMARY KEY)");
  await client.exec(
    await readFile(
      new URL(
        "../../db/src/migrations/20261013225457_app-agent-sessions/migration.sql",
        import.meta.url
      ),
      "utf-8"
    )
  );
  await client.query("INSERT INTO app (id) VALUES ($1)", [appId]);
});

afterEach(async () => {
  await client.close();
});

const row = async () => {
  const [session] = await database
    .select()
    .from(appAgentSession)
    .where(eq(appAgentSession.appId, appId));
  return session;
};

describe("durable agent session leases (Postgres)", () => {
  it("atomically admits only one concurrent editing workflow", async () => {
    const results = await Promise.allSettled([
      loadResumeStep(appId, "run-a"),
      loadResumeStep(appId, "run-b"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected")
    ).toHaveLength(1);
    const session = await row();
    expect(session?.activeRunId).toMatch(/^run-[ab]$/u);
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("reclaims its own lease on step retry and resumes opaque state on a later turn", async () => {
    await loadResumeStep(appId, "run-a");
    await expect(loadResumeStep(appId, "run-a")).resolves.toEqual({
      resumeFrom: undefined,
      sandboxName: undefined,
    });
    await persistResumeStep(appId, "run-a", resumeFrom, `app-agent-${appId}`);
    await releaseSessionStep(appId, "run-a");
    await expect(loadResumeStep(appId, "run-b")).resolves.toEqual({
      resumeFrom,
      sandboxName: `app-agent-${appId}`,
    });
  });

  it("starts a fresh Pi conversation for a completed legacy fx session", async () => {
    await loadResumeStep(appId, "run-fx");
    await persistResumeStep(
      appId,
      "run-fx",
      { ...resumeFrom, data: { acpSessionId: "legacy" }, harnessId: "fx" },
      `app-agent-${appId}`
    );
    await releaseSessionStep(appId, "run-fx");
    await expect(loadResumeStep(appId, "run-pi")).resolves.toEqual({});
    const session = await row();
    expect(session?.activeRunId).toBe("run-pi");
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("prevents another run from saving, renewing, releasing or deleting the active session", async () => {
    await loadResumeStep(appId, "run-a");
    await expect(
      persistResumeStep(appId, "run-b", resumeFrom, "foreign-vm")
    ).rejects.toThrow("another editing turn");
    await expect(renewSession(appId, "run-b")).rejects.toThrow(
      "no longer owns"
    );
    await releaseSessionStep(appId, "run-b");
    await cancelAppAgent(appId, "run-b");
    const session = await row();
    expect(session?.activeRunId).toBe("run-a");
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
  });

  it("removes a cancelled sandbox before clearing its lease and resume handle", async () => {
    await loadResumeStep(appId, "run-a");
    await persistResumeStep(appId, "run-a", resumeFrom, `app-agent-${appId}`);
    mocks.deleteSandbox.mockImplementation(async () => {
      const session = await row();
      expect(session?.activeRunId).toBe("run-a");
    });
    await cancelAppAgent(appId, "run-a");
    expect(mocks.deleteSandbox).toHaveBeenCalledWith(`app-agent-${appId}`);
    expect(await row()).toMatchObject({
      activeRunId: null,
      resumeState: null,
      sandboxName: null,
    });
  });

  it("retains the lease when sandbox deletion fails", async () => {
    await loadResumeStep(appId, "run-a");
    mocks.deleteSandbox.mockRejectedValueOnce(new Error("Cleanup unavailable"));
    await expect(cancelAppAgent(appId, "run-a")).rejects.toThrow(
      "Cleanup unavailable"
    );
    await expect(loadResumeStep(appId, "run-b")).rejects.toThrow(
      "already being edited"
    );
  });

  it("recovers an abandoned lease without attaching to an uncheckpointed turn", async () => {
    await loadResumeStep(appId, "run-a");
    await persistResumeStep(appId, "run-a", resumeFrom, `app-agent-${appId}`);
    await database
      .update(appAgentSession)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(appAgentSession.appId, appId));
    await expect(loadResumeStep(appId, "run-b")).resolves.toEqual({
      resumeFrom: undefined,
      sandboxName: undefined,
    });
    // Sandbox setup, after claiming the lease, discards the abandoned VM.
    expect(mocks.deleteSandbox).not.toHaveBeenCalled();
    expect(await row()).toMatchObject({
      activeRunId: "run-b",
      resumeState: null,
      sandboxName: null,
    });
  });
});
