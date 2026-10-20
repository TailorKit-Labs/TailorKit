import { randomBytes, randomInt } from "node:crypto";

import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { hashSecret } from "@patchsmith/api-utils/hashing";
import { db } from "@patchsmith/db";
import { cliAuthSession, cliToken } from "@patchsmith/db/schema/cli-auth";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { authenticateCliRequest } from "#cli-token";
import { env } from "#env";
import { o, protectedRouter, cliRouter } from "#procedures";
import { canonicalizeScope, scopeSchema } from "#scope";

const deviceCodeBytes = 32;
const deployTokenBytes = 32;
const userCodeLength = 9;
const userCodeSections = 3;
// 5 minutes
const authExpiresInMilliseconds = 5 * 60 * 1000;
// 12 hours
const tokenExpiresInMilliseconds = 12 * 60 * 60 * 1000;

// Skip out some characters to avoid confusion with similar characters (e.g. 0/O, 1/I, etc.)
const userCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const hashCliSecret = (value: string): string => {
  if (
    !(
      env.AUTH_SECRET !== undefined &&
      env.AUTH_SECRET !== null &&
      env.AUTH_SECRET !== ""
    )
  ) {
    throw new Error("AUTH_SECRET is required for CLI auth secret hashing.");
  }

  return hashSecret(value, env.AUTH_SECRET);
};

const generateSecret = (bytes: number): string =>
  randomBytes(bytes).toString("base64url");

const generateUserCode = (): string => {
  let code = "";

  for (let index = 0; index < userCodeLength; index += 1) {
    code += userCodeAlphabet.charAt(randomInt(userCodeAlphabet.length));
  }

  const sectionLength = Math.floor(userCodeLength / userCodeSections);

  const sections = [];
  for (let i = 0; i < userCodeSections; i += 1) {
    sections.push(code.slice(i * sectionLength, (i + 1) * sectionLength));
  }

  return sections.join("-");
};

const normalizeUserCode = (userCode: string): string =>
  userCode.trim().replaceAll("-", "").toUpperCase();

const startCliAuth = protectedRouter
  .meta(
    openapi({
      method: "POST",
      path: "/start",
    })
  )
  .input(z.object({ body: z.object({}) }))
  .output(
    z.object({
      body: z.object({
        deviceCode: z.string(),
        expiresAt: z.date(),
        userCode: z.string(),
      }),
    })
  )
  .handler(async ({ context }) => {
    const deviceCode = generateSecret(deviceCodeBytes);
    const userCode = generateUserCode();
    const expiresAt = new Date(Date.now() + authExpiresInMilliseconds);

    await db.insert(cliAuthSession).values({
      deviceCodeHash: hashCliSecret(deviceCode),
      expiresAt,
      projectId: context.project.id,
      userCodeHash: hashCliSecret(normalizeUserCode(userCode)),
    });

    return {
      body: {
        deviceCode,
        expiresAt,
        userCode,
      },
    };
  });

const approveCliAuth = protectedRouter
  .meta(
    openapi({
      method: "POST",
      path: "/approve",
    })
  )
  .input(
    z.object({
      body: z.object({
        scope: scopeSchema,
        userCode: z.string().min(1),
      }),
    })
  )
  .output(z.object({ body: z.object({ id: z.string() }) }))
  .handler(async ({ context, input }) => {
    const scope = canonicalizeScope(input.body.scope);
    const [session] = await db
      .update(cliAuthSession)
      .set({
        scope: scope.scope,
        scopeKey: scope.scopeKey,
        status: "approved",
      })
      .where(
        and(
          eq(cliAuthSession.projectId, context.project.id),
          eq(
            cliAuthSession.userCodeHash,
            hashCliSecret(normalizeUserCode(input.body.userCode))
          ),
          eq(cliAuthSession.status, "pending"),
          gt(cliAuthSession.expiresAt, new Date())
        )
      )
      .returning({ id: cliAuthSession.id });

    if (!session) {
      throw new ORPCError("NOT_FOUND", {
        message: "CLI auth session not found.",
      });
    }

    return { body: session };
  });

const denyCliAuth = protectedRouter
  .meta(
    openapi({
      method: "POST",
      path: "/deny",
    })
  )
  .input(z.object({ body: z.object({ userCode: z.string().min(1) }) }))
  .output(z.object({ body: z.object({ id: z.string() }) }))
  .handler(async ({ context, input }) => {
    const [session] = await db
      .update(cliAuthSession)
      .set({ status: "denied" })
      .where(
        and(
          eq(cliAuthSession.projectId, context.project.id),
          eq(
            cliAuthSession.userCodeHash,
            hashCliSecret(normalizeUserCode(input.body.userCode))
          ),
          eq(cliAuthSession.status, "pending"),
          gt(cliAuthSession.expiresAt, new Date())
        )
      )
      .returning({ id: cliAuthSession.id });

    if (!session) {
      throw new ORPCError("NOT_FOUND", {
        message: "CLI auth session not found.",
      });
    }

    return { body: session };
  });

const pollCliAuth = protectedRouter
  .meta(
    openapi({
      method: "POST",
      path: "/poll",
    })
  )
  .input(z.object({ body: z.object({ deviceCode: z.string().min(1) }) }))
  .output(
    z.object({
      body: z.discriminatedUnion("status", [
        z.object({ status: z.literal("pending") }),
        z.object({ status: z.literal("denied") }),
        z.object({
          deployToken: z.string(),
          scope: scopeSchema,
          status: z.literal("approved"),
        }),
        z.object({ status: z.literal("expired") }),
      ]),
    })
  )
  .handler(async ({ context, input }) => {
    const deviceCodeHash = hashCliSecret(input.body.deviceCode);
    const now = new Date();
    const session = await db.query.cliAuthSession.findFirst({
      where: {
        deviceCodeHash,
        projectId: context.project.id,
      },
    });

    if (!session) {
      throw new ORPCError("NOT_FOUND", {
        message: "CLI auth session not found.",
      });
    }

    await db
      .update(cliAuthSession)
      .set({ lastPolledAt: new Date() })
      .where(eq(cliAuthSession.id, session.id));

    if (session.expiresAt.getTime() <= now.getTime()) {
      return { body: { status: "expired" as const } };
    }

    if (session.status === "denied") {
      return { body: { status: "denied" as const } };
    }

    if (session.status === "pending") {
      return { body: { status: "pending" as const } };
    }

    if (
      !session.scope ||
      !(
        session.scopeKey !== undefined &&
        session.scopeKey !== null &&
        session.scopeKey !== ""
      )
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Approved CLI auth session is missing scope.",
      });
    }
    let sessionScope: ReturnType<typeof canonicalizeScope>;
    try {
      sessionScope = canonicalizeScope(session.scope);
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "Approved CLI auth session has an invalid scope.",
      });
    }
    if (sessionScope.scopeKey !== session.scopeKey) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Approved CLI auth session has an invalid scope.",
      });
    }

    const deployToken = generateSecret(deployTokenBytes);
    const deletedSession = await db.transaction(async (tx) => {
      const [consumedSession] = await tx
        .delete(cliAuthSession)
        .where(
          and(
            eq(cliAuthSession.id, session.id),
            eq(cliAuthSession.projectId, context.project.id),
            eq(cliAuthSession.status, "approved"),
            gt(cliAuthSession.expiresAt, now)
          )
        )
        .returning();

      if (!consumedSession) {
        return null;
      }

      if (
        !consumedSession.scope ||
        !(
          consumedSession.scopeKey !== undefined &&
          consumedSession.scopeKey !== null &&
          consumedSession.scopeKey !== ""
        )
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Approved CLI auth session is missing scope.",
        });
      }
      let consumedScope: ReturnType<typeof canonicalizeScope>;
      try {
        consumedScope = canonicalizeScope(consumedSession.scope);
      } catch {
        throw new ORPCError("BAD_REQUEST", {
          message: "Approved CLI auth session has an invalid scope.",
        });
      }
      if (consumedScope.scopeKey !== consumedSession.scopeKey) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Approved CLI auth session has an invalid scope.",
        });
      }

      await tx.insert(cliToken).values({
        expiresAt: new Date(now.getTime() + tokenExpiresInMilliseconds),
        projectId: context.project.id,
        scope: consumedScope.scope,
        scopeKey: consumedScope.scopeKey,
        tokenHash: hashCliSecret(deployToken),
      });

      return { ...consumedSession, scope: consumedScope.scope };
    });

    if (!deletedSession) {
      throw new ORPCError("NOT_FOUND", {
        message: "CLI auth session not found.",
      });
    }

    return {
      body: {
        deployToken,
        scope: deletedSession.scope,
        status: "approved" as const,
      },
    };
  });

const verifyCliAuthToken = cliRouter
  .meta(
    openapi({
      method: "POST",
      path: "/verify-token",
    })
  )
  .input(z.object({ body: z.object({ deployToken: z.string().min(1) }) }))
  .output(z.object({ body: z.object({ scope: scopeSchema }) }))
  .handler(async ({ context, input }) => {
    const token = await authenticateCliRequest(context, input.body.deployToken);

    await db
      .update(cliToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(cliToken.id, token.id));

    return { body: { scope: token.scope } };
  });

export const cliAuthRouter = o.meta(openapi({ prefix: "/cli-auth" })).router({
  approve: approveCliAuth,
  deny: denyCliAuth,
  poll: pollCliAuth,
  start: startCliAuth,
  verifyToken: verifyCliAuthToken,
});
