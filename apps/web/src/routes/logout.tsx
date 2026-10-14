import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "#lib/auth-client";

const LogoutPage = () => (
  <main className="grid min-h-svh place-items-center bg-background p-6">
    <p className="text-sm text-muted-foreground">Signing out...</p>
  </main>
);

export const Route = createFileRoute("/logout")({
  beforeLoad: async ({ context }) => {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JavaScript may reject with arbitrary values; this boundary records or preserves the original failure.
    await authClient.signOut().catch((error: unknown) => {
      console.error(error);
    });

    context.queryClient.clear();
    redirect({
      throw: true,
      replace: true,
      search: { email: undefined, return_to: undefined },
      to: "/login",
    });
  },
  component: LogoutPage,
  preload: false,
  ssr: false,
});
