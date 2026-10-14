import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/account")({
  beforeLoad: ({ location }) => {
    if (location.pathname === "/account") {
      Route.redirect({ throw: true, to: "/account/profile" });
    }
  },
});
