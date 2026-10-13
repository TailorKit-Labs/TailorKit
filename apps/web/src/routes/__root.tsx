import { AnchoredToastProvider, ToastProvider } from "@tailorkit/ui/toast";
import { a11yDevtoolsPlugin } from "@tanstack/devtools-a11y/react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

import { orpc } from "#lib/orpc";

import { NotFound } from "../components/not-found";
import {
  ThemeProvider,
  fallbackTheme,
  getCachedThemeScript,
  getUserTheme,
  useTheme,
} from "../lib/theme";

import appCss from "../index.css?url";

export interface RouterAppContext {
  orpc: typeof orpc;
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  head: () => ({
    links: [
      {
        href: appCss,
        rel: "stylesheet",
      },
      {
        href: "/favicon.svg",
        rel: "icon",
        type: "image/svg+xml",
      },
      {
        href: "/apple-touch-icon.png",
        rel: "apple-touch-icon",
        sizes: "180x180",
      },
      {
        href: "/favicon-32x32.png",
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
      },
      {
        href: "/favicon-16x16.png",
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
      },
      {
        href: "/site.webmanifest",
        rel: "manifest",
      },
    ],
    meta: [
      {
        charSet: "utf-8",
      },
      {
        content: "width=device-width, initial-scale=1",
        name: "viewport",
      },
      {
        title: "TailorKit",
      },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: getCachedThemeScript() }} />
        <HeadContent />
      </head>
      <body className="relative">
        <ThemeProvider>
          <UserThemeSync />
          <div className="relative isolate flex min-h-svh flex-col">
            <ToastProvider>
              <AnchoredToastProvider>{children}</AnchoredToastProvider>
            </ToastProvider>
          </div>
        </ThemeProvider>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            {
              name: "Tanstack Query",
              render: <ReactQueryDevtoolsPanel />,
            },
            formDevtoolsPlugin(),
            a11yDevtoolsPlugin(),
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

function UserThemeSync() {
  const { setTheme, theme } = useTheme();
  const { data: session, isPending } = useQuery(
    orpc.user.getSession.queryOptions()
  );
  const lastSyncedTheme = useRef<string | null>(null);
  const userTheme = session
    ? (getUserTheme(session.user) ?? fallbackTheme)
    : fallbackTheme;

  useEffect(() => {
    if (isPending || !session) {
      return;
    }

    if (lastSyncedTheme.current === userTheme) {
      return;
    }

    if (userTheme !== theme) {
      setTheme(userTheme);
    }

    lastSyncedTheme.current = userTheme;
  }, [isPending, session, setTheme, theme, userTheme]);

  return null;
}
