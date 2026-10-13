import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/account")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/account") {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router intercepts its redirect and not-found response objects when they are thrown from route loaders.
      throw Route.redirect({ to: "/account/profile" });
    }
  },
});
