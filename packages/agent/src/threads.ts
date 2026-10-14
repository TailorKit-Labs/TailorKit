import { and, eq } from "drizzle-orm";

export class AppAgentThreadError extends Error {
  constructor() {
    super(
      "Thread not found for this app or no longer resumable. Start a new thread."
    );
    this.name = "AppAgentThreadError";
  }
}

/** Call only after authorizing the app. An explicit ID always means resume. */
export const resolveAppAgentThread = async (
  appId: string,
  threadId?: string
) => {
  const { db } = await import("@tailorkit/db");
  const { appAgentThread } = await import("@tailorkit/db/schema/apps");
  if (threadId !== undefined) {
    const [thread] = await db
      .select()
      .from(appAgentThread)
      .where(
        and(eq(appAgentThread.id, threadId), eq(appAgentThread.appId, appId))
      );
    if (!thread || thread.invalidatedAt !== null) {
      throw new AppAgentThreadError();
    }
    return thread.id;
  }
  const [thread] = await db
    .insert(appAgentThread)
    .values({ appId })
    .returning({ id: appAgentThread.id });
  if (!thread) {
    throw new Error("Could not create agent thread.");
  }
  return thread.id;
};
