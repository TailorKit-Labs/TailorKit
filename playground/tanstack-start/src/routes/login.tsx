import { useLoaderData, createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "#components/auth-screen";
import { loadSignInChoices } from "#lib/auth.functions";

const LoginPage = () => (
  <AuthScreen choices={useLoaderData({ from: "/login" })} />
);

export const Route = createFileRoute("/login")({
  component: LoginPage,
  loader: () => loadSignInChoices(),
});
