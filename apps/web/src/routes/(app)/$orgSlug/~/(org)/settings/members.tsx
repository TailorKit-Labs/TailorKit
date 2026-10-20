import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@patchsmith/ui/input-group";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@patchsmith/ui/tabs";
import { toastManager } from "@patchsmith/ui/toast";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useParams, createFileRoute } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";

import { InvitationsTable } from "#components/members/invitations-table";
import type { InvitationRow } from "#components/members/invitations-table";
import { InviteMembersDialog } from "#components/members/invite-members-dialog";
import { MembersTable } from "#components/members/members-table";
import type { MemberRow } from "#components/members/members-table";
import { PageLayout } from "#components/page-layout";
import { client, orpc } from "#lib/orpc";

const OrgSettingsMembers = () => {
  const { orgSlug } = useParams({
    from: "/(app)/$orgSlug/~/(org)/settings/members",
  });

  const queryClient = useQueryClient();
  const { data: session } = useQuery(orpc.user.getSession.queryOptions());

  const { data: members } = useSuspenseQuery(
    orpc.org.getMembers.queryOptions({ input: { orgSlug } })
  );

  const { data: invitations } = useSuspenseQuery(
    orpc.org.getOrgInvitations.queryOptions({ input: { orgSlug } })
  );

  const [search, setSearch] = useState("");

  const currentMember = members.find(
    (member) => member.user.id === session?.user?.id
  );

  const canManage =
    currentMember?.role === "owner" || currentMember?.role === "admin";

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) =>
      await client.org.removeMember({ memberId, orgSlug }),
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error ? cause.message : "Failed to remove member";

      toastManager.add({ description: message, title: "Error", type: "error" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries(
        orpc.org.getMembers.queryOptions({ input: { orgSlug } })
      );
      toastManager.add({ title: "Member removed", type: "success" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) =>
      await client.org.inviteMember({
        email,
        orgSlug,
        role: z.enum(["member", "admin"]).parse(role),
      }),
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error ? cause.message : "Failed to resend invitation";

      toastManager.add({ description: message, title: "Error", type: "error" });
    },
    onSuccess: () => {
      toastManager.add({ title: "Invitation resent", type: "success" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (invitationId: string) =>
      await client.org.revokeInvitation({ invitationId, orgSlug }),
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error ? cause.message : "Failed to revoke invitation";

      toastManager.add({ description: message, title: "Error", type: "error" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries(
        orpc.org.getOrgInvitations.queryOptions({ input: { orgSlug } })
      );
      toastManager.add({ title: "Invitation revoked", type: "success" });
    },
  });

  const memberRows = useMemo<MemberRow[]>(
    () =>
      members.map((member) => ({
        createdAt: member.createdAt,
        email: member.user.email,
        id: member.id,
        isCurrentUser: member.user.id === session?.user?.id,
        isOwner: member.role === "owner",
        name: member.user.name,
        role: member.role,
        userId: member.user.id,
      })),
    [members, session?.user?.id]
  );

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries(
      orpc.org.getMembers.queryOptions({ input: { orgSlug } })
    );
    void queryClient.invalidateQueries(
      orpc.org.getOrgInvitations.queryOptions({ input: { orgSlug } })
    );
  }, [orgSlug, queryClient]);

  const handleRemoveMember = useCallback(
    (id: string) => {
      removeMutation.mutate(id);
    },
    [removeMutation]
  );

  const handleResendInvitation = useCallback(
    (invitation: InvitationRow) => {
      resendMutation.mutate({
        email: invitation.email,
        role: invitation.role ?? "member",
      });
    },
    [resendMutation]
  );

  const handleRevokeInvitation = useCallback(
    (id: string) => {
      revokeMutation.mutate(id);
    },
    [revokeMutation]
  );

  return (
    <PageLayout
      actions={
        canManage ? (
          <InviteMembersDialog orgSlug={orgSlug} onSuccess={invalidateAll} />
        ) : null
      }
      description="Manage who has access to this organisation."
      title="Members"
    >
      <Tabs defaultValue="members">
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTab value="members">Members</TabsTab>
            <TabsTab value="invitations">
              Pending invitations
              {invitations.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                  {invitations.length}
                </span>
              )}
            </TabsTab>
          </TabsList>

          <div className="relative w-64 max-w-full">
            <InputGroup>
              <InputGroupInput
                placeholder="Search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
            </InputGroup>
          </div>
        </div>

        <TabsPanel value="members" className="mt-4">
          <MembersTable
            members={memberRows}
            canManage={canManage}
            onRemove={handleRemoveMember}
            removePending={removeMutation.isPending}
            search={search}
          />
        </TabsPanel>

        <TabsPanel value="invitations" className="mt-4">
          <InvitationsTable
            invitations={invitations}
            canManage={canManage}
            onResend={handleResendInvitation}
            onRevoke={handleRevokeInvitation}
            resendPending={resendMutation.isPending}
            revokePending={revokeMutation.isPending}
          />
        </TabsPanel>
      </Tabs>
    </PageLayout>
  );
};

export const Route = createFileRoute(
  "/(app)/$orgSlug/~/(org)/settings/members"
)({
  component: OrgSettingsMembers,
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.query(
        context.orpc.org.getMembers.queryOptions({
          input: { orgSlug: params.orgSlug },
        })
      ),
      context.queryClient
        .query(
          context.orpc.org.getOrgInvitations.queryOptions({
            input: { orgSlug: params.orgSlug },
          })
        )
        .catch(() => null),
    ]);
  },
});
