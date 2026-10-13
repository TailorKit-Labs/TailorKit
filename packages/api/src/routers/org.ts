import { ORPCError } from "@orpc/server";
import { auth } from "@tailorkit/auth";
import { db } from "@tailorkit/db";
import { invitation } from "@tailorkit/db/schema/index";
import { and, eq } from "drizzle-orm";
import z from "zod";

import { protectedProcedure, requireOrg } from "../procedures";

export const orgRouter = {
  /**
   * List all members of an org. Caller must be a member.
   */
  getMembers: protectedProcedure
    .input(z.object({ orgSlug: z.string() }))
    .use(requireOrg())
    .handler(async ({ input, context }) => {
      const org = await db.query.organization.findFirst({
        where: {
          slug: input.orgSlug,
          members: { userId: context.user.id },
        },
        with: {
          members: { with: { user: true } },
        },
      });

      if (!org) {
        throw new ORPCError("NOT_FOUND");
      }

      return org.members.filter(
        (m): m is typeof m & { user: NonNullable<typeof m.user> } =>
          Boolean(m.user)
      );
    }),

  /**
   * List pending invitations for an org. Caller must be owner or admin.
   */
  getOrgInvitations: protectedProcedure
    .input(z.object({ orgSlug: z.string() }))
    .use(requireOrg({ invitation: ["read"] }))
    .handler(({ context }) =>
      db.query.invitation.findMany({
        where: {
          organizationId: context.org.id,
          status: "pending",
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
      })
    ),

  /**
   * Invite a member by email. Caller must be owner or admin.
   * Role cannot be set to "owner" — ownership must be transferred explicitly.
   */
  inviteMember: protectedProcedure
    .input(
      z.object({
        orgSlug: z.string(),
        email: z.email(),
        role: z.enum(["member", "admin"]),
      })
    )
    .use(
      requireOrg({
        invitation: ["create"],
      })
    )
    .handler(({ input, context }) =>
      auth.api.createInvitation({
        body: {
          organizationId: context.org.id,
          email: input.email,
          role: input.role,
          resend: true,
        },
        headers: context.headers,
      })
    ),

  /**
   * Remove a member from an org.
   *
   * Rules:
   * - Caller must be owner or admin.
   * - Owners cannot be removed (must transfer ownership first).
   * - Admins can only remove members, not other admins.
   */
  removeMember: protectedProcedure
    .input(z.object({ orgSlug: z.string(), memberId: z.string() }))
    .use(requireOrg({ member: ["delete"] }))
    .handler(({ input, context }) =>
      auth.api.removeMember({
        body: {
          organizationId: context.org.id,
          memberIdOrEmail: input.memberId,
        },
        headers: context.headers,
      })
    ),

  /**
   * Revoke a pending invitation for an org. Caller must be owner or admin.
   */
  revokeInvitation: protectedProcedure
    .input(z.object({ orgSlug: z.string(), invitationId: z.string() }))
    .use(requireOrg({ invitation: ["cancel"] }))
    .handler(async ({ input, context }) => {
      const [revoked] = await db
        .update(invitation)
        .set({ status: "canceled" })
        .where(
          and(
            eq(invitation.id, input.invitationId),
            eq(invitation.organizationId, context.org.id),
            eq(invitation.status, "pending")
          )
        )
        .returning({ id: invitation.id });

      if (!revoked) {
        throw new ORPCError("NOT_FOUND");
      }

      return revoked;
    }),
};
