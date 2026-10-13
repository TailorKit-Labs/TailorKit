import { useState } from "react";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@tailorkit/ui/sheet";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@tailorkit/ui/sidebar";
import type { TailorKitApp } from "tailorkit/react";
import type { ReactNode } from "react";
import type { DemoSession } from "@playground/shared/auth";
import { AppSidebar } from "#components/app-sidebar";
import { signOutDemoUser } from "#lib/auth-client";
import {
  RenderSlot,
  TailorKitProvider,
  useApps,
  useViewContext,
  tailor,
} from "#lib/tailorkit-client";

function ShellContent({ children, session }: { children: ReactNode; session: DemoSession }) {
  const { data: apps, error: appsError, isPending: appsPending } = useApps();
  const [selectedApp, setSelectedApp] = useState<TailorKitApp | null>(null);
  useViewContext("/", {
    context: {
      user: { id: session.user.id, name: session.user.name },
      team: { id: session.team.id, name: session.team.name },
    },
  });

  async function signOut() {
    await signOutDemoUser();
    tailor.clearCache();
    window.location.assign("/login");
  }

  return (
    <SidebarProvider>
      <AppSidebar
        apps={apps}
        appsError={appsError}
        appsPending={appsPending}
        onSelectApp={setSelectedApp}
        selectedApp={selectedApp}
        session={session}
        signOut={() => void signOut()}
      />
      <SidebarInset>
        <header className="flex h-14 items-center gap-3 border-b px-5">
          <SidebarTrigger />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{session.team.name}</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-6 md:p-10">{children}</main>
      </SidebarInset>
      <Sheet
        onOpenChange={(open) => {
          if (!open) setSelectedApp(null);
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
              <RenderSlot app={selectedApp} slot="panel" />
            </SheetPanel>
          </SheetPopup>
        ) : null}
      </Sheet>
    </SidebarProvider>
  );
}

export function TailorKitShell({
  children,
  session,
}: {
  children: ReactNode;
  session: DemoSession;
}) {
  return (
    <TailorKitProvider>
      <ShellContent session={session}>{children}</ShellContent>
    </TailorKitProvider>
  );
}
