import {
  useRouteContext,
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  redirect,
} from "@tanstack/react-router";

import { PatchsmithShell } from "#components/patchsmith-shell";
import { loadSession } from "#lib/auth.functions";

import css from "#styles.css?url";

const AppShell = () => {
  const { session } = useRouteContext({ from: "__root__" });

  if (!session) {
    return <Outlet />;
  }

  return (
    <PatchsmithShell session={session}>
      <Outlet />
    </PatchsmithShell>
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
      redirect({ throw: true, to: "/login" });
    }

    if (session && location.pathname === "/login") {
      redirect({ throw: true, to: "/" });
    }

    return { session };
  },
  component: AppShell,
  head: () => ({
    links: [{ href: css, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { title: "Patchsmith Playground" },
    ],
  }),
  shellComponent: RootDocument,
});
