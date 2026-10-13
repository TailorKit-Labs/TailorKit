import {
  useRouteContext,
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
} from "@tanstack/react-router";

import { TailorKitShell } from "#components/tailorkit-shell";
import { loadSession } from "#lib/auth.functions";

import css from "../styles.css?url";

const AppShell = () => {
  const { session } = useRouteContext({ from: "__root__" });
  if (!session) {
    return <Outlet />;
  }
  return (
    <TailorKitShell session={session}>
      <Outlet />
    </TailorKitShell>
  );
};

const RootDocument = ({ children }: { children: React.ReactNode }) => (
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
  component: AppShell,
  head: () => ({
    links: [{ href: css, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "TailorKit Playground" },
    ],
  }),
  shellComponent: RootDocument,
});
