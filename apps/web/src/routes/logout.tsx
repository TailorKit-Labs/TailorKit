import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "#lib/auth-client";

export const Route = createFileRoute("/logout")({
  beforeLoad: async ({ context }) => {
    await authClient.signOut().catch((error) => {
      console.error(error);
    });

    context.queryClient.clear();
    throw redirect({
      replace: true,
      search: { email: undefined, return_to: undefined },
      to: "/login",
    });
  },
  component: LogoutPage,
  preload: false,
  ssr: false,
});

function LogoutPage() {
  return (
    <main className="bg-background grid min-h-svh place-items-center p-6">
      <p className="text-muted-foreground text-sm">Signing out...</p>
    </main>
  );
}
