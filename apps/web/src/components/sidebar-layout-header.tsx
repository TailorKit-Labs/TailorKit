import { Separator } from "@tailorkit/ui/separator";
import { SidebarTrigger, useSidebar } from "@tailorkit/ui/sidebar";

import { useHeaderActions } from "#components/header-actions";
import { NavBreadcrumb } from "#components/nav-breadcrumb";

export const SidebarLayoutHeader = () => {
  const { open } = useSidebar();
  const { actions } = useHeaderActions();
  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b px-4">
      {/* Mobile: always show trigger to open sheet */}
      <SidebarTrigger className="-ml-1 lg:hidden" />
      <Separator className="h-4 lg:hidden" orientation="vertical" />
      {/* Desktop: only show trigger when sidebar is collapsed */}
      {!open && (
        <>
          <SidebarTrigger className="-ml-1 hidden lg:flex" />
          <Separator className="hidden h-4 lg:block" orientation="vertical" />
        </>
      )}
      <NavBreadcrumb />
      {Boolean(actions) && <div className="ml-auto">{actions}</div>}
    </header>
  );
};
