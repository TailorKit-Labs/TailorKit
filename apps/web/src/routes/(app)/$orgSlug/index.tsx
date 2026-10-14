import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/$orgSlug/")({
  loader: ({ params }) => {
    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router intercepts its redirect and not-found response objects when they are thrown from route loaders.
    throw redirect({
      params: { orgSlug: params.orgSlug },
      to: "/$orgSlug/~/projects",
    });
  },
});
