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
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router intercepts its redirect and not-found response objects when they are thrown from route loaders.
      throw redirect({ to: returnTo ?? "/" });
    }
  },
  validateSearch: authRedirectSearchSchema,
});
