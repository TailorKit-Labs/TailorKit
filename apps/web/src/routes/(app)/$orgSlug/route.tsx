import { ORPCError } from "@orpc/client";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { NotFound } from "#components/not-found";
import { clearActiveOrg, getActiveOrg } from "#lib/active-org";

export const Route = createFileRoute("/(app)/$orgSlug")({
  errorComponent: NotFound,
  loader: async ({ context, params }) => {
    const orgs = await context.queryClient.query(
      context.orpc.user.getOrgs.queryOptions()
    );
    if (!orgs.some((org) => org.slug === params.orgSlug)) {
      await clearActiveOrg();
      throw redirect({
        reloadDocument: true,
        replace: true,
        to: orgs.length === 0 ? "/account/request-organization" : "/",
      });
    }

    const org = await context.queryClient
      .query(
        context.orpc.user.getOrg.queryOptions({
          input: { orgSlug: params.orgSlug },
        })
      )
      .catch(async (error: ErrorOptions["cause"]) => {
        if (
          !(error instanceof ORPCError) ||
          error.code !== "NOT_FOUND" ||
          (await getActiveOrg()) !== params.orgSlug
        ) {
          throw error;
        }

        await clearActiveOrg();
        throw redirect({ reloadDocument: true, replace: true, to: "/" });
      });
    if (!org) {
      throw notFound();
    }
  },
  notFoundComponent: NotFound,
});
