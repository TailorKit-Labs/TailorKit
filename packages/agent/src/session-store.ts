import type { HarnessV1ResumeSessionState } from "@ai-sdk/harness";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { FatalError } from "workflow";
import { z } from "zod";

import { appSandboxName } from "./identity";
import { deleteSandbox } from "./sandbox";

const sessionStore = async () => {
  const { db } = await import("@tailorkit/db");
  const { appAgentSession } = await import("@tailorkit/db/schema/apps");
  return { appAgentSession, db };
};

const leaseDurationMs = 60 * 60_000;
const resumeEnvelope = z.object({
  data: z.json(),
  harnessId: z.enum(["pi", "fx"]),
  specificationVersion: z.literal("harness-v1"),
  type: z.literal("resume-session"),
});
// The adapter owns the opaque payload, including unfinished-turn settings.
// Validate its envelope without stripping fields required by the adapter.
const resumeSchema = z.custom<HarnessV1ResumeSessionState>(
  (value) => resumeEnvelope.safeParse(value).success
);

export interface SavedAgentSession {
  resumeFrom?: HarnessV1ResumeSessionState;
  sandboxName?: string;
}

/** Claim before touching the VM: two workflow runs must never share a session. */
export const loadResumeStep = async (
  appId: string,
  runId: string
): Promise<SavedAgentSession> => {
  "use step";
  const { appAgentSession, db } = await sessionStore();
  await db.insert(appAgentSession).values({ appId }).onConflictDoNothing();
  const [claimed] = await db
    .update(appAgentSession)
    .set({
      activeRunId: runId,
      leaseExpiresAt: new Date(Date.now() + leaseDurationMs),
      // Evaluate against the pre-update owner atomically. An abandoned turn
      // cannot safely use the previous completed turn's session journal.
      resumeState: sql`case when ${appAgentSession.activeRunId} is not null and ${appAgentSession.activeRunId} <> ${runId} then null else ${appAgentSession.resumeState} end`,
      sandboxName: sql`case when ${appAgentSession.activeRunId} is not null and ${appAgentSession.activeRunId} <> ${runId} then null else ${appAgentSession.sandboxName} end`,
    })
    .where(
      and(
        eq(appAgentSession.appId, appId),
        or(
          isNull(appAgentSession.activeRunId),
          eq(appAgentSession.activeRunId, runId),
          lt(appAgentSession.leaseExpiresAt, new Date())
        )
      )
    )
    .returning();
  if (!claimed) {
    throw new FatalError(
      "This app is already being edited. Retry after the active run finishes."
    );
  }
  const resumeFrom =
    claimed.resumeState === null
      ? undefined
      : resumeSchema.parse(JSON.parse(claimed.resumeState));
  // fx journals cannot be imported into Pi. Sandbox setup replaces the VM,
  // preserving app source on its Drive and starting a new Pi conversation.
  if (resumeFrom?.harnessId === "fx") {
    return {};
  }
  return { resumeFrom, sandboxName: claimed.sandboxName ?? undefined };
};

export const renewSession = async (appId: string, runId: string) => {
  const { appAgentSession, db } = await sessionStore();
  const [owned] = await db
    .update(appAgentSession)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseDurationMs) })
    .where(
      and(
        eq(appAgentSession.appId, appId),
        eq(appAgentSession.activeRunId, runId)
      )
    )
    .returning({ appId: appAgentSession.appId });
  if (!owned) {
    throw new FatalError("The app agent no longer owns this editing turn.");
  }
};

/** Persist before stopping the VM; keep the lease until its Drive is released. */
export const persistResumeStep = async (
  appId: string,
  runId: string,
  resumeFrom: HarnessV1ResumeSessionState,
  sandboxName: string
) => {
  "use step";
  const { appAgentSession, db } = await sessionStore();
  const [saved] = await db
    .update(appAgentSession)
    .set({ resumeState: JSON.stringify(resumeFrom), sandboxName })
    .where(
      and(
        eq(appAgentSession.appId, appId),
        eq(appAgentSession.activeRunId, runId)
      )
    )
    .returning({ appId: appAgentSession.appId });
  if (!saved) {
    throw new FatalError(
      "Cannot save a session owned by another editing turn."
    );
  }
};

export const releaseSessionStep = async (appId: string, runId: string) => {
  "use step";
  const { appAgentSession, db } = await sessionStore();
  await db
    .update(appAgentSession)
    .set({ activeRunId: null, leaseExpiresAt: null })
    .where(
      and(
        eq(appAgentSession.appId, appId),
        eq(appAgentSession.activeRunId, runId)
      )
    );
};

/** Hard cancellation skips workflow finally blocks, so callers must clean up. */
export const cancelAppAgent = async (appId: string, runId: string) => {
  "use step";
  const { appAgentSession, db } = await sessionStore();
  const [owned] = await db
    .update(appAgentSession)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseDurationMs) })
    .where(
      and(
        eq(appAgentSession.appId, appId),
        eq(appAgentSession.activeRunId, runId)
      )
    )
    .returning({ appId: appAgentSession.appId });
  if (!owned) {
    return;
  }
  // Clear resume state only after deletion; a cleanup failure retains the
  // lease so another turn cannot attach to a still-running cancelled sandbox.
  await deleteSandbox(appSandboxName(appId));
  await db
    .update(appAgentSession)
    .set({
      activeRunId: null,
      leaseExpiresAt: null,
      resumeState: null,
      sandboxName: null,
    })
    .where(
      and(
        eq(appAgentSession.appId, appId),
        eq(appAgentSession.activeRunId, runId)
      )
    );
};
