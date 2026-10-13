import { useState } from "react";
import { Button } from "@tailorkit/ui/button";
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
  const { data: apps } = useApps();
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
      <AppSidebar session={session} signOut={() => void signOut()} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-3 border-b px-5">
          <SidebarTrigger />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-sm">{session.team.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {apps?.map((app) => (
              <Button
                key={app.id}
                onClick={() => setSelectedApp(selectedApp?.id === app.id ? null : app)}
                size="sm"
                variant={selectedApp?.id === app.id ? "secondary" : "outline"}
              >
                {app.name ?? "App"}
              </Button>
            ))}
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-6 md:p-10">{children}</main>
      </SidebarInset>
      {selectedApp ? (
        <aside className="fixed inset-y-4 right-4 z-40 flex w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-xl">
          <header className="flex h-12 items-center justify-between border-b px-4">
            <span className="truncate font-medium text-sm">{selectedApp.name ?? "App"}</span>
            <Button onClick={() => setSelectedApp(null)} size="sm" variant="ghost">
              Close
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <RenderSlot app={selectedApp} slot="panel" />
          </div>
        </aside>
      ) : null}
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
