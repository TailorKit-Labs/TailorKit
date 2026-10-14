import { createFileRoute, redirect } from "@tanstack/react-router";

const Onboarding = () => null;

export const Route = createFileRoute("/(app)/onboarding")({
  component: Onboarding,
  loader: async ({ context }) => {
    const orgs = await context.queryClient.query(
      context.orpc.user.getOrgs.queryOptions()
    );

    if (orgs.length > 0) {
      redirect({ throw: true, to: "/" });
    }

    redirect({ throw: true, to: "/account/request-organization" });
  },
});
