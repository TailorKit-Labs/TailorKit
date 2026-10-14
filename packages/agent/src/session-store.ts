import type { HarnessV1ResumeSessionState } from "@ai-sdk/harness";
import { and, eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { z } from "zod";

import { threadSandboxName } from "./identity";
import { deleteSandbox } from "./sandbox";

const sessionStore = async () => {
  const { db } = await import("@tailorkit/db");
  const { appAgentLease, appAgentThread } =
    await import("@tailorkit/db/schema/apps");
  return { appAgentLease, appAgentThread, db };
};

const leaseDurationMs = 60 * 60_000;
const resumeEnvelope = z.object({
  data: z.json(),
  harnessId: z.literal("pi"),
  specificationVersion: z.literal("harness-v1"),
  type: z.literal("resume-session"),
});
// Validate without stripping the adapter's opaque unfinished-turn settings.
const resumeSchema = z.custom<HarnessV1ResumeSessionState>(
  (value) => resumeEnvelope.safeParse(value).success
);

export interface SavedAgentSession {
  cleanupSandboxName?: string;
  resumeFrom?: HarnessV1ResumeSessionState;
  sandboxName?: string;
}

const assertLeaseAvailable = async (
  activeRunId: string,
  expiresAt: Date | null
) => {
  if (expiresAt !== null && expiresAt.getTime() < Date.now()) {
    return;
  }
  // External cancellation skips workflow cleanup; its durable status can free the lease.
  const { getRun } = await import("workflow/api");
  const { promise: timeout, reject } = Promise.withResolvers<never>();
  // Bound the status lookup while the caller holds the workspace row lock.
  const timer = setTimeout(() => {
    reject(new Error("Timed out checking the active app agent workflow."));
  }, 5000);
  try {
    const status = await Promise.race([getRun(activeRunId).status, timeout]);
    if (status === "pending" || status === "running") {
      throw new FatalError(
        `This app is already being edited by workflow ${activeRunId}. Retry after the active run finishes.`
      );
    }
  } finally {
    clearTimeout(timer);
  }
};

/** Conversations are independent; the lease excludes all writers for this app. */
export const loadResumeStep = async (
  appId: string,
  threadId: string,
  runId: string
): Promise<SavedAgentSession> => {
  "use step";
  const { appAgentLease, appAgentThread, db } = await sessionStore();
  return await db.transaction(async (tx) => {
    await tx.insert(appAgentLease).values({ appId }).onConflictDoNothing();
    const [lease] = await tx
      .select()
      .from(appAgentLease)
      .where(eq(appAgentLease.appId, appId))
      .for("update");
    if (!lease) {
      throw new FatalError("Could not claim the app workspace.");
    }
    if (lease.activeRunId === runId && lease.activeThreadId !== threadId) {
      throw new FatalError("This editing run belongs to another thread.");
    }
    const otherRun = lease.activeRunId !== null && lease.activeRunId !== runId;
    if (otherRun && lease.activeRunId !== null) {
      await assertLeaseAvailable(lease.activeRunId, lease.leaseExpiresAt);
    }
    const [thread] = await tx
      .select()
      .from(appAgentThread)
      .where(
        and(eq(appAgentThread.id, threadId), eq(appAgentThread.appId, appId))
      );
    if (
      !thread ||
      thread.invalidatedAt !== null ||
      (otherRun && lease.activeThreadId === threadId)
    ) {
      throw new FatalError(
        "Thread not found for this app or no longer resumable. Start a new thread."
      );
    }
    // The previous worker may have mutated its journal beyond its checkpoint.
    const abandonedThreadId = otherRun
      ? (lease.activeThreadId ?? undefined)
      : undefined;
    if (abandonedThreadId !== undefined) {
      await tx
        .update(appAgentThread)
        .set({
          invalidatedAt: new Date(),
          resumeState: null,
          sandboxName: null,
        })
        .where(
          and(
            eq(appAgentThread.id, abandonedThreadId),
            eq(appAgentThread.appId, appId)
          )
        );
    }
    const cleanupSandboxName =
      abandonedThreadId === undefined
        ? (lease.cleanupSandboxName ?? undefined)
        : threadSandboxName(abandonedThreadId);
    await tx
      .update(appAgentLease)
      .set({
        activeRunId: runId,
        activeThreadId: threadId,
        cleanupSandboxName: cleanupSandboxName ?? null,
        leaseExpiresAt: new Date(Date.now() + leaseDurationMs),
      })
      .where(eq(appAgentLease.appId, appId));
    return {
      cleanupSandboxName,
      resumeFrom:
        thread.resumeState === null
          ? undefined
          : resumeSchema.parse(JSON.parse(thread.resumeState)),
      sandboxName: thread.sandboxName ?? undefined,
    };
  });
};

export const renewSession = async (appId: string, runId: string) => {
  const { appAgentLease, db } = await sessionStore();
  const [owned] = await db
    .update(appAgentLease)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseDurationMs) })
    .where(
      and(eq(appAgentLease.appId, appId), eq(appAgentLease.activeRunId, runId))
    )
    .returning({ appId: appAgentLease.appId });
  if (!owned) {
    throw new FatalError("The app agent no longer owns this editing turn.");
  }
};

/** Persist only the selected thread while keeping the app lease until VM stop. */
export const persistResumeStep = async (
  appId: string,
  threadId: string,
  runId: string,
  resumeFrom: HarnessV1ResumeSessionState,
  sandboxName: string
) => {
  "use step";
  const { appAgentLease, appAgentThread, db } = await sessionStore();
  await db.transaction(async (tx) => {
    const [owned] = await tx
      .select()
      .from(appAgentLease)
      .where(
        and(
          eq(appAgentLease.appId, appId),
          eq(appAgentLease.activeRunId, runId),
          eq(appAgentLease.activeThreadId, threadId)
        )
      )
      .for("update");
    if (!owned) {
      throw new FatalError(
        "Cannot save a session owned by another editing turn."
      );
    }
    const [saved] = await tx
      .update(appAgentThread)
      .set({ resumeState: JSON.stringify(resumeFrom), sandboxName })
      .where(
        and(eq(appAgentThread.id, threadId), eq(appAgentThread.appId, appId))
      )
      .returning({ id: appAgentThread.id });
    if (!saved) {
      throw new FatalError("Cannot save an unknown thread.");
    }
  });
};

export const releaseSessionStep = async (appId: string, runId: string) => {
  "use step";
  const { appAgentLease, db } = await sessionStore();
  await db
    .update(appAgentLease)
    .set({
      activeRunId: null,
      activeThreadId: null,
      cleanupSandboxName: null,
      leaseExpiresAt: null,
    })
    .where(
      and(eq(appAgentLease.appId, appId), eq(appAgentLease.activeRunId, runId))
    );
};

/** Hard cancellation must invalidate only the owning run's conversation. */
export const cancelAppAgent = async (appId: string, runId: string) => {
  "use step";
  const { appAgentLease, appAgentThread, db } = await sessionStore();
  const [owned] = await db
    .update(appAgentLease)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseDurationMs) })
    .where(
      and(eq(appAgentLease.appId, appId), eq(appAgentLease.activeRunId, runId))
    )
    .returning({
      cleanupSandboxName: appAgentLease.cleanupSandboxName,
      threadId: appAgentLease.activeThreadId,
    });
  if (!owned) {
    return;
  }
  // Keep ownership when deletion fails so a new writer cannot race cleanup.
  if (owned.cleanupSandboxName !== null) {
    await deleteSandbox(owned.cleanupSandboxName);
  }
  if (owned.threadId !== null) {
    await deleteSandbox(threadSandboxName(owned.threadId));
  }
  await db.transaction(async (tx) => {
    const [lease] = await tx
      .select()
      .from(appAgentLease)
      .where(
        and(
          eq(appAgentLease.appId, appId),
          eq(appAgentLease.activeRunId, runId)
        )
      )
      .for("update");
    if (!lease) {
      return;
    }
    if (owned.threadId !== null) {
      await tx
        .update(appAgentThread)
        .set({
          invalidatedAt: new Date(),
          resumeState: null,
          sandboxName: null,
        })
        .where(
          and(
            eq(appAgentThread.id, owned.threadId),
            eq(appAgentThread.appId, appId)
          )
        );
    }
    await tx
      .update(appAgentLease)
      .set({
        activeRunId: null,
        activeThreadId: null,
        cleanupSandboxName: null,
        leaseExpiresAt: null,
      })
      .where(eq(appAgentLease.appId, appId));
  });
};
