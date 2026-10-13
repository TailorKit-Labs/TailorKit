import { SidebarInset, SidebarProvider } from "@tailorkit/ui/sidebar";
import { Outlet, createFileRoute } from "@tanstack/react-router";

import { HeaderActionsProvider } from "#components/header-actions";
import { SidebarLayoutHeader } from "#components/sidebar-layout-header";
import { ProjectSidebar } from "#components/sidebar/project-sidebar";

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug")({
  component: ProjectLayout,
  loader: ({ context, params }) =>
    context.queryClient.query(
      context.orpc.project.get.queryOptions({
        input: { orgSlug: params.orgSlug, projectSlug: params.projectSlug },
      })
    ),
});

function ProjectLayout() {
  const { orgSlug, projectSlug } = Route.useParams();

  return (
    <HeaderActionsProvider>
      <SidebarProvider>
        <ProjectSidebar orgSlug={orgSlug} projectSlug={projectSlug} />
        <SidebarInset>
          <SidebarLayoutHeader />
          <main className="flex flex-1 flex-col gap-4 p-4">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </HeaderActionsProvider>
  );
}
