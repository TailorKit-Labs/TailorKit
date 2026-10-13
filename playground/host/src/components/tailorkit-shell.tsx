import type { DemoSession } from "@playground/shared/auth";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@tailorkit/ui/sheet";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@tailorkit/ui/sidebar";
import { useState } from "react";
import type { ReactNode } from "react";
import type { TailorKitApp } from "tailorkit/react";

import { AppSidebar } from "#components/app-sidebar";
import { signOutDemoUser } from "#lib/auth-client";
import { localPlaygroundApps } from "#lib/local-apps";
import {
  RenderSlot,
  TailorKitProvider,
  useApps,
  useViewContext,
  tailor,
} from "#lib/tailorkit-client";

const signOutImplementation = async () => {
  await signOutDemoUser();
  tailor.clearCache();
  window.location.assign("/login");
};

const ShellContent = ({
  children,
  session,
}: {
  children: ReactNode;
  session: DemoSession;
}) => {
  const { data: apps, error: appsError, isPending: appsPending } = useApps();
  const installedApps = [
    ...localPlaygroundApps.map(
      (localApp) => apps?.find((app) => app.id === localApp.id) ?? localApp
    ),
    ...(apps?.filter(
      (app) => !localPlaygroundApps.some((localApp) => localApp.id === app.id)
    ) ?? []),
  ];
  const [selectedApp, setSelectedApp] = useState<TailorKitApp | null>(null);
  useViewContext("/", {
    context: {
      team: { id: session.team.id, name: session.team.name },
      user: { id: session.user.id, name: session.user.name },
    },
  });

  const signOut = signOutImplementation;

  return (
    <SidebarProvider>
      <AppSidebar
        apps={installedApps}
        appsError={appsError}
        appsPending={appsPending}
        onSelectApp={setSelectedApp}
        selectedApp={selectedApp}
        session={session}
        signOut={() => signOut()}
      />
      <SidebarInset>
        <header className="flex h-14 items-center gap-3 border-b px-5">
          <SidebarTrigger />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{session.team.name}</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-6 md:p-10">
          {children}
        </main>
      </SidebarInset>
      <Sheet
        onOpenChange={(open) => {
          if (!open) {
            setSelectedApp(null);
          }
        }}
        open={selectedApp !== null}
      >
        {selectedApp ? (
          <SheetPopup side="right">
            <SheetHeader>
              <SheetTitle>{selectedApp.name ?? "App"}</SheetTitle>
              <SheetDescription>App panel</SheetDescription>
            </SheetHeader>
            <SheetPanel>
              <TailorKitProvider apps={installedApps}>
                <RenderSlot.Controlled
                  app={selectedApp}
                  context={{
                    team: { id: session.team.id, name: session.team.name },
                    user: { id: session.user.id, name: session.user.name },
                  }}
                  slot="panel"
                  status="ready"
                  view="/"
                />
              </TailorKitProvider>
            </SheetPanel>
          </SheetPopup>
        ) : null}
      </Sheet>
    </SidebarProvider>
  );
};

export const TailorKitShell = ({
  children,
  session,
}: {
  children: ReactNode;
  session: DemoSession;
}) => (
  <TailorKitProvider>
    <ShellContent session={session}>{children}</ShellContent>
  </TailorKitProvider>
);
