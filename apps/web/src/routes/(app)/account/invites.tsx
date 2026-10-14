import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tailorkit/ui/empty";
import { toastManager } from "@tailorkit/ui/toast";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MailIcon } from "lucide-react";

import { AccountLayout } from "#components/account-layout";
import { PageLayout } from "#components/page-layout";
import { client, orpc } from "#lib/orpc";

const formatDate = (value: Date | string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));

const InvitesPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: invitations } = useSuspenseQuery(
    orpc.user.getPendingInvitations.queryOptions()
  );

  const acceptMutation = useMutation({
    mutationFn: async (invitationId: string) =>
      await client.user.acceptInvitation({ invitationId }),
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error ? cause.message : "Failed to accept invitation";
      toastManager.add({ description: message, title: "Error", type: "error" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries(orpc.user.getOrgs.queryOptions());
      void queryClient.invalidateQueries(
        orpc.user.getPendingInvitations.queryOptions()
      );
      void navigate({ to: "/account/organizations" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (invitationId: string) =>
      await client.user.rejectInvitation({ invitationId }),
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error ? cause.message : "Failed to decline invitation";
      toastManager.add({ description: message, title: "Error", type: "error" });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries(
        orpc.user.getPendingInvitations.queryOptions()
      );
    },
  });

  const isMutating = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <AccountLayout>
      <PageLayout
        description="Review your current organisation invitations."
        title="Invites"
      >
        {invitations.length === 0 ? (
          <CardFrame>
            <Card>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MailIcon />
                  </EmptyMedia>
                  <EmptyTitle>No pending invites</EmptyTitle>
                  <EmptyDescription>
                    Organisation invitations sent to your email will appear
                    here.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </Card>
          </CardFrame>
        ) : (
          <CardFrame>
            {invitations.map((invitation) => (
              <Card key={invitation.id}>
                <CardHeader>
                  <div className="min-w-0">
                    <CardTitle>
                      {invitation.organization?.name ?? "Organisation invite"}
                    </CardTitle>
                    <CardDescription>
                      Invited as {invitation.role ?? "member"}
                    </CardDescription>
                  </div>
                  <CardAction>
                    <Badge variant="info">Pending</Badge>
                  </CardAction>
                </CardHeader>
                <CardPanel>
                  <div className="flex flex-col gap-4 pt-0 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      Expires {formatDate(invitation.expiresAt)}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        disabled={isMutating}
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          rejectMutation.mutate(invitation.id);
                        }}
                      >
                        Decline
                      </Button>
                      <Button
                        disabled={isMutating}
                        size="sm"
                        onClick={() => {
                          acceptMutation.mutate(invitation.id);
                        }}
                      >
                        Accept
                      </Button>
                    </div>
                  </div>
                </CardPanel>
              </Card>
            ))}
          </CardFrame>
        )}
      </PageLayout>
    </AccountLayout>
  );
};

export const Route = createFileRoute("/(app)/account/invites")({
  component: InvitesPage,
  loader: async ({ context }) => {
    await context.queryClient.query(
      context.orpc.user.getPendingInvitations.queryOptions()
    );
  },
});
