import type { DemoSession } from "@playground/shared/auth";
import { Button } from "@tailorkit/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@tailorkit/ui/sidebar";
import { Link } from "@tanstack/react-router";
import {
  Blocks,
  CheckSquare2,
  CircleDot,
  LayoutDashboard,
  LogOut,
} from "lucide-react";
import type { TailorKitApp } from "tailorkit/react";

const navItems = [
  { icon: LayoutDashboard, label: "Overview", to: "/" },
  { icon: CircleDot, label: "Issues", to: "/issues" },
] as const;

export const AppSidebar = ({
  apps,
  appsError,
  appsPending,
  onSelectApp,
  selectedApp,
  session,
  signOut,
}: {
  apps: TailorKitApp[] | undefined;
  appsError: Error | null;
  appsPending: boolean;
  onSelectApp: (app: TailorKitApp) => void;
  selectedApp: TailorKitApp | null;
  session: DemoSession;
  signOut: () => void;
}) => (
  <Sidebar>
    <SidebarHeader>
      <div className="flex items-center gap-3 px-2 py-1">
        <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <CheckSquare2 aria-hidden="true" className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Issue tracker</p>
          <p className="truncate text-xs text-muted-foreground">
            {session.team.name}
          </p>
        </div>
      </div>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Workspace</SidebarGroupLabel>
        <SidebarMenu>
          {navItems.map(({ icon: Icon, label, to }) => (
            <SidebarMenuItem key={to}>
              <SidebarMenuButton
                render={
                  <Link
                    to={to}
                    activeOptions={{ exact: to === "/" }}
                    activeProps={{ "data-active": true }}
                  />
                }
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Apps</SidebarGroupLabel>
        <SidebarMenu>
          {apps?.map((app: TailorKitApp) => (
            <SidebarMenuItem key={app.id}>
              <SidebarMenuButton
                isActive={selectedApp?.id === app.id}
                onClick={() => onSelectApp(app)}
              >
                <Blocks aria-hidden="true" />
                <span>{app.name ?? "App"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {appsPending ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              Loading apps…
            </li>
          ) : null}
          {appsError ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              Platform apps unavailable
            </li>
          ) : null}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-sidebar-accent/60 p-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium">
          {session.user.name
            .split(" ")
            .map((part) => part[0])
            .join("")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {session.team.key}
          </p>
        </div>
        <Button
          aria-label="Sign out"
          onClick={signOut}
          size="icon-sm"
          variant="ghost"
        >
          <LogOut aria-hidden="true" />
        </Button>
      </div>
    </SidebarFooter>
  </Sidebar>
);
