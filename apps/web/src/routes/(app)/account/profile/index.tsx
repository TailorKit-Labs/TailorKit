"use client";

import {
  Card,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@patchsmith/ui/card";
import { useAppForm } from "@patchsmith/ui/form";
import { toastManager } from "@patchsmith/ui/toast";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { PageLayout } from "#components/page-layout";
import { authClient } from "#lib/auth-client";
import { orpc } from "#lib/orpc.ts";

const ProfilePage = () => {
  const { data: session } = useQuery(orpc.user.getSession.queryOptions());

  const form = useAppForm({
    defaultValues: {
      name: session?.user?.name ?? "",
    },
    onSubmit: async ({ value }) => {
      const result = await authClient.updateUser({
        name: value.name,
      });

      if (result.error) {
        toastManager.add({
          description: result.error.message ?? "Failed to update profile",
          title: "Error",
          type: "error",
        });
        return;
      }

      toastManager.add({
        description: "Your profile has been updated.",
        title: "Profile updated",
        type: "success",
      });
    },
    validators: {
      onSubmit: z.object({
        name: z.string().min(1, "Name is required"),
      }),
    },
  });

  return (
    <PageLayout
      description="Manage the name shown across your PatchSmith account."
      title="Profile"
    >
      <CardFrame className="w-full">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>

          <form
            id="profile-form"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <CardPanel className="max-w-lg">
              <div className="flex flex-col gap-4">
                <form.AppField name="name">
                  {(field) => (
                    <field.TextField
                      label="Display name"
                      placeholder="Your name"
                    />
                  )}
                </form.AppField>
              </div>
            </CardPanel>
          </form>
        </Card>

        <CardFrameFooter className="relative flex justify-end">
          <form.AppForm>
            <form.SubmitButton form="profile-form" size="sm">
              Save changes
            </form.SubmitButton>
          </form.AppForm>
        </CardFrameFooter>
      </CardFrame>
    </PageLayout>
  );
};

export const Route = createFileRoute("/(app)/account/profile/")({
  component: ProfilePage,
});
