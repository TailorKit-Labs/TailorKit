import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import { Field, FieldLabel } from "@tailorkit/ui/field";
import { Input } from "@tailorkit/ui/input";
import { useParams, createFileRoute } from "@tanstack/react-router";

import { PageLayout } from "#components/page-layout";

const OrgSettingsGeneral = () => {
  const { orgSlug } = useParams({ from: "/(app)/$orgSlug/~/(org)/settings/" });
  const orgName = orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1);

  return (
    <PageLayout
      description="Manage your organisation settings."
      title="General"
    >
      <CardFrame>
        <Card>
          <CardHeader>
            <CardTitle>Organisation details</CardTitle>
            <CardDescription>
              Update your organisation name and URL slug.
            </CardDescription>
          </CardHeader>
          <CardPanel>
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel>Organisation name</FieldLabel>
                <Input defaultValue={orgName} />
              </Field>
              <Field>
                <FieldLabel>Slug</FieldLabel>
                <Input defaultValue={orgSlug} />
                <p className="text-xs text-muted-foreground">
                  Your org URL: tailorkit.com/{orgSlug}
                </p>
              </Field>
            </div>
          </CardPanel>
        </Card>
        <CardFrameFooter className="relative flex justify-end">
          <Button size="sm">Save changes</Button>
        </CardFrameFooter>
      </CardFrame>
    </PageLayout>
  );
};

export const Route = createFileRoute("/(app)/$orgSlug/~/(org)/settings/")({
  component: OrgSettingsGeneral,
});
