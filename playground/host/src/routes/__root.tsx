import { HeadContent, Outlet, Scripts, createRootRoute, redirect } from "@tanstack/react-router";
import { TailorKitShell } from "#components/tailorkit-shell";
import { loadSession } from "#lib/auth.functions";
import css from "../styles.css?url";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const session = await loadSession();
    if (!session && location.pathname !== "/login") {
      throw redirect({ to: "/login" });
    }
    if (session && location.pathname === "/login") {
      throw redirect({ to: "/" });
    }
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TailorKit Playground" },
    ],
    links: [{ rel: "stylesheet", href: css }],
  }),
  shellComponent: RootDocument,
  component: AppShell,
});

function AppShell() {
  const { session } = Route.useRouteContext();
  if (!session) return <Outlet />;
  return (
    <TailorKitShell session={session}>
      <Outlet />
    </TailorKitShell>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
