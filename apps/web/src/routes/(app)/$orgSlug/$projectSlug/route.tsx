import { SidebarInset, SidebarProvider } from "@patchsmith/ui/sidebar";
import { useParams, Outlet, createFileRoute } from "@tanstack/react-router";

import { HeaderActionsProvider } from "#components/header-actions";
import { SidebarLayoutHeader } from "#components/sidebar-layout-header";
import { ProjectSidebar } from "#components/sidebar/project-sidebar";

const ProjectLayout = () => {
  const { orgSlug, projectSlug } = useParams({
    from: "/(app)/$orgSlug/$projectSlug",
  });

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
};

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug")({
  component: ProjectLayout,
  loader: async ({ context, params }) =>
    await context.queryClient.query(
      context.orpc.project.get.queryOptions({
        input: { orgSlug: params.orgSlug, projectSlug: params.projectSlug },
      })
    ),
});
