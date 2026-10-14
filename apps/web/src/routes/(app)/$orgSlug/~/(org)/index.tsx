import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/$orgSlug/~/(org)/")({
  loader: ({ params }) => {
    redirect({
      throw: true,
      params: { orgSlug: params.orgSlug },
      to: "/$orgSlug/~/projects",
    });
  },
});
