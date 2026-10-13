import { createFileRoute, redirect } from "@tanstack/react-router";

const Onboarding = () => null;

export const Route = createFileRoute("/(app)/onboarding")({
  component: Onboarding,
  loader: async ({ context }) => {
    const orgs = await context.queryClient.query(
      context.orpc.user.getOrgs.queryOptions()
    );

    if (orgs.length > 0) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router intercepts its redirect and not-found response objects when they are thrown from route loaders.
      throw redirect({ to: "/" });
    }

    // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router intercepts its redirect and not-found response objects when they are thrown from route loaders.
    throw redirect({ to: "/account/request-organization" });
  },
});
