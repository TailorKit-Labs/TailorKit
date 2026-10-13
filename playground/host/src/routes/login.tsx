import { createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "#components/auth-screen";
import { loadSignInChoices } from "#lib/auth.functions";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  loader: () => loadSignInChoices(),
});

function LoginPage() {
  return <AuthScreen choices={Route.useLoaderData()} />;
}
