import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug/")({
  loader: ({ params }) => {
    redirect({
      throw: true,
      params: { orgSlug: params.orgSlug, projectSlug: params.projectSlug },
      to: "/$orgSlug/$projectSlug/apps",
    });
  },
});
