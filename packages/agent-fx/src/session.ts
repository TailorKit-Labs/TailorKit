import type { HarnessV1ResumeSessionState } from "@ai-sdk/harness";
import { and, eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { z } from "zod";

import type { AppAgentInput } from "./input";
import {
  deleteSandbox,
  getSandbox,
  prepareSandbox,
  sandboxName,
} from "./sandbox";
import { hostSchemaPath, prepareWorkspace } from "./workspace";

const store = async () => {
  const { db } = await import("@patchsmith/db");
  const { appAgentLease, appAgentThread } =
    await import("@patchsmith/db/schema/apps");
  return { appAgentLease, appAgentThread, db };
};
const resumeSchema = z.custom<HarnessV1ResumeSessionState>(
  (value) =>
    z
      .object({
        data: z.json(),
        harnessId: z.literal("fx"),
        specificationVersion: z.literal("harness-v1"),
        type: z.literal("resume-session"),
      })
      .safeParse(value).success
);

export const startTurn = async (input: AppAgentInput, runId: string) => {
  const { db, appAgentLease, appAgentThread } = await store();
  const resumeFrom = await db.transaction(async (tx) => {
    await tx
      .insert(appAgentLease)
      .values({ appId: input.appId })
      .onConflictDoNothing();
    const [lease] = await tx
      .select()
      .from(appAgentLease)
      .where(eq(appAgentLease.appId, input.appId))
      .for("update");
    if (!lease || (lease.activeRunId !== null && lease.activeRunId !== runId)) {
      throw new FatalError(
        "This app is already being edited. Retry after the active turn finishes."
      );
    }
    const [thread] = await tx
      .select()
      .from(appAgentThread)
      .where(
        and(
          eq(appAgentThread.appId, input.appId),
          eq(appAgentThread.id, input.threadId)
        )
      );
    if (!thread || thread.invalidatedAt !== null) {
      throw new FatalError(
        "This conversation cannot be resumed. Start a new thread."
      );
    }
    const saved =
      thread.resumeState === null
        ? undefined
        : resumeSchema.safeParse(JSON.parse(thread.resumeState));
    if (saved && !saved.success) {
      throw new FatalError("Start a new conversation to use fx for this app.");
    }
    await tx
      .update(appAgentLease)
      .set({ activeRunId: runId, activeThreadId: input.threadId })
      .where(eq(appAgentLease.appId, input.appId));
    return saved?.data;
  });
  const sandbox = await prepareSandbox(input, resumeFrom !== undefined);
  if (input.schema !== undefined) {
    await sandbox.currentSession().writeFiles([
      {
        content: Buffer.from(JSON.stringify(input.schema)),
        path: hostSchemaPath,
      },
    ]);
  }
  await prepareWorkspace(sandbox.currentSession(), input);
  return resumeFrom;
};

export const assertOwnership = async (appId: string, runId: string) => {
  const { db, appAgentLease } = await store();
  const [lease] = await db
    .select()
    .from(appAgentLease)
    .where(
      and(eq(appAgentLease.appId, appId), eq(appAgentLease.activeRunId, runId))
    );
  if (!lease) {
    throw new FatalError("This run no longer owns the app workspace.");
  }
};

export const finishTurn = async (
  input: AppAgentInput,
  runId: string,
  resumeFrom: HarnessV1ResumeSessionState
) => {
  const { db, appAgentLease, appAgentThread } = await store();
  const name = sandboxName(input.threadId);
  const serialized = JSON.stringify(resumeFrom);
  await db.transaction(async (tx) => {
    const [lease] = await tx
      .select()
      .from(appAgentLease)
      .where(eq(appAgentLease.appId, input.appId))
      .for("update");
    if (lease?.activeRunId !== runId) {
      const [thread] = await tx
        .select()
        .from(appAgentThread)
        .where(
          and(
            eq(appAgentThread.appId, input.appId),
            eq(appAgentThread.id, input.threadId)
          )
        );
      // A durable step may retry after its previous database commit succeeded.
      if (thread?.resumeState === serialized) {
        return;
      }
      throw new FatalError("This run no longer owns the app workspace.");
    }
    // Keep cancellation and the next writer out until the snapshot is stopped.
    const sandbox = await getSandbox(name);
    await sandbox.stop();
    await tx
      .update(appAgentThread)
      .set({ resumeState: serialized, sandboxName: name })
      .where(
        and(
          eq(appAgentThread.appId, input.appId),
          eq(appAgentThread.id, input.threadId)
        )
      );
    await tx
      .update(appAgentLease)
      .set({ activeRunId: null, activeThreadId: null })
      .where(eq(appAgentLease.appId, input.appId));
  });
};

export const cancelTurn = async (appId: string, runId: string) => {
  const { db, appAgentLease, appAgentThread } = await store();
  const owned = and(
    eq(appAgentLease.appId, appId),
    eq(appAgentLease.activeRunId, runId)
  );
  await db.transaction(async (tx) => {
    const [lease] = await tx
      .select()
      .from(appAgentLease)
      .where(owned)
      .for("update");
    if (!lease) {
      return;
    }
    // Hold ownership until the VM is gone, including when cancellation is retried.
    if (lease.activeThreadId !== null) {
      await deleteSandbox(lease.activeThreadId);
      await tx
        .update(appAgentThread)
        .set({
          invalidatedAt: new Date(),
          resumeState: null,
          sandboxName: null,
        })
        .where(
          and(
            eq(appAgentThread.appId, appId),
            eq(appAgentThread.id, lease.activeThreadId)
          )
        );
    }
    await tx
      .update(appAgentLease)
      .set({ activeRunId: null, activeThreadId: null, leaseExpiresAt: null })
      .where(owned);
  });
};
