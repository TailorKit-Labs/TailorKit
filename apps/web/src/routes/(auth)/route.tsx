import { createFileRoute, redirect } from "@tanstack/react-router";

import { authRedirectSearchSchema } from "#lib/auth-search";

export const Route = createFileRoute("/(auth)")({
  loader: async ({ context, location }) => {
    const [session] = await Promise.all([
      context.queryClient.query(context.orpc.user.getSession.queryOptions()),
      context.queryClient.query(
        context.orpc.user.getSocialProviders.queryOptions()
      ),
    ]);

    if (session.session || session.user) {
      const returnTo = authRedirectSearchSchema.parse(
        location.search
      ).return_to;

      redirect({ throw: true, to: returnTo ?? "/" });
    }
  },
  validateSearch: authRedirectSearchSchema,
});
