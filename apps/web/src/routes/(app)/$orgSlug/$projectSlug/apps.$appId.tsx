/* oxlint-disable react/no-unstable-nested-components */
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { flexRender, useTable } from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { ArrowLeftIcon, DownloadIcon, RocketIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { toastManager } from "@tailorkit/ui/toast";
import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@tailorkit/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@tailorkit/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tailorkit/ui/table";
import { DateAgo } from "@tailorkit/ui/date";
import { AppLogo } from "#components/apps/app-logo";
import { renderSortableHeader } from "#components/members/member-table-utils";
import { PageLayout } from "#components/page-layout";
import { client, orpc } from "#lib/orpc";
import { dataTableFeatures } from "#lib/table";

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug/apps/$appId")({
  loader: ({ context, params }) =>
    context.queryClient.query(
      context.orpc.apps.get.queryOptions({
        input: {
          appId: params.appId,
          orgSlug: params.orgSlug,
          projectSlug: params.projectSlug,
        },
      }),
    ),
  component: AppPage,
});

interface DeploymentRow {
  id: string;
  publicId: string;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function getDeploymentStatusVariant(status: string): "info" | "outline" | "success" | "warning" {
  if (status === "published") {
    return "success";
  }
  if (status === "deploying" || status === "verifying") {
    return "warning";
  }
  if (status === "uploading") {
    return "info";
  }
  return "outline";
}

function DeploymentsTable({
  currentDeploymentId,
  deployments,
}: {
  currentDeploymentId: string | null;
  deployments: DeploymentRow[];
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<typeof dataTableFeatures, DeploymentRow>[]>(
    () => [
      {
        accessorKey: "id",
        header: "Deployment",
        size: 300,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">{row.original.publicId}</p>
            {row.original.id === currentDeploymentId ? (
              <p className="text-muted-foreground text-xs">Current production deployment</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 130,
        cell: ({ row }) => (
          <Badge size="lg" variant={getDeploymentStatusVariant(row.original.status)}>
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        size: 140,
        sortFn: "datetime",
        cell: ({ row }) => <DateAgo date={row.original.createdAt} />,
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        size: 140,
        sortFn: "datetime",
        cell: ({ row }) => <DateAgo date={row.original.updatedAt} />,
      },
    ],
    [currentDeploymentId],
  );

  const table = useTable({
    columns,
    data: deployments,
    enableSortingRemoval: false,
    features: dataTableFeatures,
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <CardFrame className="w-full">
      <Table className="table-fixed" variant="card">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="hover:bg-transparent" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} style={{ width: `${header.column.getSize()}px` }}>
                  {renderSortableHeader(header)}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardFrame>
  );
}

function AppPage() {
  const { appId, orgSlug, projectSlug } = Route.useParams();
  const sourceExportInput = { appId, orgSlug, projectSlug };
  const { data: sourceExportStatus } = useQuery(
    orpc.apps.sourceExportStatus.queryOptions({ input: sourceExportInput }),
  );
  const sourceExportMutation = useMutation({
    mutationFn: () => client.apps.exportSource(sourceExportInput),
    onError: (error: unknown) => {
      toastManager.add({
        title: "Source export failed",
        description: error instanceof Error ? error.message : "Unable to export app source.",
        type: "error",
      });
    },
    onSuccess: ({ archive, fileName }) => {
      const downloadUrl = URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.download = fileName;
      link.href = downloadUrl;
      link.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
      toastManager.add({ title: "Source export downloaded", type: "success" });
    },
  });
  const { data: app } = useSuspenseQuery(
    orpc.apps.get.queryOptions({ input: { appId, orgSlug, projectSlug } }),
  );

  return (
    <PageLayout
      actions={
        <div className="flex items-center gap-2">
          {sourceExportStatus === "available" ? (
            <Button
              disabled={sourceExportMutation.isPending}
              onClick={() => sourceExportMutation.mutate()}
              size="sm"
              variant="outline"
            >
              <DownloadIcon />
              {sourceExportMutation.isPending ? "Preparing export..." : "Export source"}
            </Button>
          ) : null}
          <Button
            render={<Link params={{ orgSlug, projectSlug }} to="/$orgSlug/$projectSlug/apps" />}
            size="sm"
            variant="outline"
          >
            <ArrowLeftIcon />
            Back to apps
          </Button>
        </div>
      }
      description={app.description || "App and deployment details."}
      title={
        <span className="flex items-center gap-3">
          <AppLogo className="size-11" logoPaths={app.logoPaths} name={app.name} />
          <span>{app.name}</span>
        </span>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>Installation scope</CardFrameTitle>
            <CardFrameDescription className="min-w-0 w-full">
              <div className="grid min-w-0 w-full gap-2">
                <Badge
                  className="max-w-full min-w-0 break-all whitespace-normal"
                  size="sm"
                  variant="outline"
                >
                  {app.scope.name}
                </Badge>
                <pre className="max-h-64 max-w-full overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-foreground text-xs">
                  {JSON.stringify(app.scope.value, null, 2)}
                </pre>
              </div>
            </CardFrameDescription>
          </CardFrameHeader>
        </CardFrame>
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>Current deployment</CardFrameTitle>
            <CardFrameDescription>
              {app.currentDeployment ? app.currentDeployment.publicId : "No deployment published"}
            </CardFrameDescription>
          </CardFrameHeader>
        </CardFrame>
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>Total deployments</CardFrameTitle>
            <CardFrameDescription>{app.deployments.length}</CardFrameDescription>
          </CardFrameHeader>
        </CardFrame>
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>Created</CardFrameTitle>
            <CardFrameDescription>
              <DateAgo date={app.createdAt} />
            </CardFrameDescription>
          </CardFrameHeader>
        </CardFrame>
      </div>

      {app.deployments.length === 0 ? (
        <Empty className="mx-auto w-full rounded-lg border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RocketIcon />
            </EmptyMedia>
            <EmptyTitle>No deployments</EmptyTitle>
            <EmptyDescription>Deployments uploaded for this app will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DeploymentsTable
          currentDeploymentId={app.currentDeploymentId}
          deployments={app.deployments}
        />
      )}
    </PageLayout>
  );
}
