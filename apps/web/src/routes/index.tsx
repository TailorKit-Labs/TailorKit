import { createFileRoute, redirect } from "@tanstack/react-router";

import { clearActiveOrg, getActiveOrg } from "#lib/active-org";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const session = await context.queryClient.query(
      context.orpc.user.getSession.queryOptions()
    );

    if (!session.session) {
      redirect({
        throw: true,
        replace: true,
        search: { email: undefined, return_to: undefined },
        to: "/login",
      });
    }

    const activeOrg = await getActiveOrg();

    // This query does not use the saved selection, so a failure is not evidence
    // that the selection is invalid. Only clear it after a successful lookup.
    const orgs = await context.queryClient.query(
      context.orpc.user.getOrgs.queryOptions()
    );

    // The cookie stores a slug; accept IDs saved by older clients as well.
    const selectedOrg = orgs.find(
      (org) => org.slug === activeOrg || org.id === activeOrg
    );

    if (
      activeOrg !== undefined &&
      activeOrg !== null &&
      activeOrg !== "" &&
      !selectedOrg
    ) {
      await clearActiveOrg();
    }

    const org = selectedOrg ?? orgs[0];

    if (org?.slug) {
      redirect({
        throw: true,
        params: { orgSlug: org.slug },
        to: "/$orgSlug/~/projects",
      });
    }

    redirect({ throw: true, to: "/onboarding" });
  },
});
