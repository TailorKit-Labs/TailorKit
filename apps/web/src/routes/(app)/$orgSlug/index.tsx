import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/$orgSlug/")({
  loader: ({ params }) => {
    redirect({
      throw: true,
      params: { orgSlug: params.orgSlug },
      to: "/$orgSlug/~/projects",
    });
  },
});
