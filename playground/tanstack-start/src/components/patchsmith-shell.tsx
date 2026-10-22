import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@patchsmith/ui/sheet";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@patchsmith/ui/sidebar";
import type { DemoSession } from "@playground/shared/auth";
import type { PatchsmithApp } from "patchsmith/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { AppSidebar } from "#components/app-sidebar";
import { signOutDemoUser } from "#lib/auth-client";
import { localPlaygroundApps } from "#lib/local-apps";
import {
  RenderSlot,
  PatchsmithProvider,
  useApps,
  useViewContext,
  patchsmith,
} from "#lib/patchsmith-client";

const signOutImplementation = async () => {
  await signOutDemoUser();
  patchsmith.clearCache();
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

  const [selectedApp, setSelectedApp] = useState<PatchsmithApp | null>(null);
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
        signOut={() => {
          void (async () => {
            await signOut();
          })();
        }}
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
              <PatchsmithProvider apps={installedApps}>
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
              </PatchsmithProvider>
            </SheetPanel>
          </SheetPopup>
        ) : null}
      </Sheet>
    </SidebarProvider>
  );
};

export const PatchsmithShell = ({
  children,
  session,
}: {
  children: ReactNode;
  session: DemoSession;
}) => (
  <PatchsmithProvider>
    <ShellContent session={session}>{children}</ShellContent>
  </PatchsmithProvider>
);
