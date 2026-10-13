import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import { Link, createFileRoute } from "@tanstack/react-router";

import { AccountLayout } from "#components/account-layout";
import { CreateOrgDialog } from "#components/create-org-dialog";
import { PageLayout } from "#components/page-layout";
import { isOrgCreationManaged } from "#lib/org-creation";

const RequestOrganizationPage = () => (
  <AccountLayout>
    <PageLayout
      description={
        isOrgCreationManaged
          ? "Organisation creation is currently managed by the TailorKit team."
          : "Create a workspace for your projects and collaborators."
      }
      title="Create an organisation"
    >
      <CardFrame>
        <Card>
          <CardHeader>
            <CardTitle>
              {isOrgCreationManaged ? "Manual onboarding" : "New workspace"}
            </CardTitle>
          </CardHeader>
          <CardPanel>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {isOrgCreationManaged
                  ? "We're currently onboarding users manually. Contact us to create an organisation for your account."
                  : "Create an organisation to start building and managing TailorKit projects."}
              </p>
              <div className="flex flex-wrap gap-2">
                {isOrgCreationManaged ? (
                  <Button
                    render={
                      <a
                        aria-label="Contact us"
                        href="https://cal.com/alfiejones"
                        rel="noopener noreferrer"
                        target="_blank"
                      />
                    }
                    size="sm"
                  >
                    Contact us
                  </Button>
                ) : (
                  <CreateOrgDialog>
                    <Button size="sm">Create organisation</Button>
                  </CreateOrgDialog>
                )}
                <Button
                  render={<Link to="/account/invites" />}
                  size="sm"
                  variant="outline"
                >
                  View invites
                </Button>
              </div>
            </div>
          </CardPanel>
        </Card>
      </CardFrame>
    </PageLayout>
  </AccountLayout>
);

export const Route = createFileRoute("/(app)/account/request-organization")({
  component: RequestOrganizationPage,
});
