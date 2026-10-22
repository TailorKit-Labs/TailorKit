import type { Scope } from "@patchsmith/db/schema/scope";
import { Badge } from "@patchsmith/ui/badge";
import { CardFrame } from "@patchsmith/ui/card";
import { DateAgo } from "@patchsmith/ui/date";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@patchsmith/ui/table";
import { Link } from "@tanstack/react-router";
import { flexRender, useTable } from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { AppLogo } from "#components/apps/app-logo";
import { renderSortableHeader } from "#components/members/member-table-utils";
import { dataTableFeatures } from "#lib/table";

const getDeploymentStatusVariant = (
  status?: string
): "info" | "outline" | "success" | "warning" => {
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
};

const createAppColumns = ({
  kind,
  orgSlug,
  projectSlug,
}: {
  kind: "apps" | "installations";
  orgSlug: string;
  projectSlug: string;
}): ColumnDef<typeof dataTableFeatures, AppRow>[] => [
  {
    accessorKey: "name",
    cell: ({ row }) => (
      <div className="flex min-w-0 items-center gap-3">
        <AppLogo
          className="size-9"
          logoPaths={row.original.logoPaths}
          name={row.original.name}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            className="truncate text-sm font-medium hover:underline"
            params={{ appId: row.original.shortId, orgSlug, projectSlug }}
            to="/$orgSlug/$projectSlug/apps/$appId"
          >
            {row.original.name}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {row.original.slug}
          </span>
        </div>
      </div>
    ),
    header: kind === "installations" ? "Installation" : "App",
    size: 280,
  },
  ...(kind === "installations"
    ? ([
        {
          accessorFn: (row: AppRow) =>
            `${row.scope.name} ${JSON.stringify(row.scope.value)}`,
          cell: ({ row }) => (
            <span
              className="block truncate text-sm"
              title={`${row.original.scope.name}: ${JSON.stringify(row.original.scope.value, null, 2)}`}
            >
              <span className="font-medium">{row.original.scope.name}:</span>{" "}
              {JSON.stringify(row.original.scope.value)}
            </span>
          ),
          header: "Scope",
          id: "scope",
          size: 260,
        },
      ] satisfies ColumnDef<typeof dataTableFeatures, AppRow>[])
    : ([
        {
          accessorKey: "installationCount",
          cell: ({ row }) => (
            <span className="text-sm">{row.original.installationCount}</span>
          ),
          header: "Installs",
          size: 100,
        },
        {
          accessorKey: "deploymentCount",
          cell: ({ row }) => (
            <span className="text-sm">{row.original.deploymentCount}</span>
          ),
          header: "Deployments",
          size: 120,
        },
      ] satisfies ColumnDef<typeof dataTableFeatures, AppRow>[])),
  {
    cell: ({ row }) =>
      row.original.currentDeployment ? (
        <div className="flex flex-col items-start gap-1">
          {kind === "installations" ? (
            <span className="text-xs text-muted-foreground">
              {row.original.currentDeployment.shortId}
            </span>
          ) : null}
          <Badge
            size="lg"
            variant={getDeploymentStatusVariant(
              row.original.currentDeployment.status
            )}
          >
            {row.original.currentDeployment.status}
          </Badge>
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">None</span>
      ),
    header: kind === "installations" ? "Deployment" : "Current",
    id: "currentDeployment",
    size: 140,
  },
  {
    accessorKey: "createdAt",
    cell: ({ row }) => <DateAgo date={row.original.createdAt} />,
    header: "Created",
    size: 140,
    sortFn: "datetime",
  },
];

export const AppsTable = ({
  apps,
  footer,
  kind = "apps",
  orgSlug,
  projectSlug,
}: {
  apps: AppRow[];
  footer?: ReactNode;
  kind?: "apps" | "installations";
  orgSlug: string;
  projectSlug: string;
}) => {
  const [sorting, setSorting] = useState<SortingState>([
    { desc: true, id: "createdAt" },
  ]);

  const columns = useMemo(
    () => createAppColumns({ kind, orgSlug, projectSlug }),
    [kind, orgSlug, projectSlug]
  );

  const table = useTable({
    columns,
    data: apps,
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
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className="w-[var(--column-width)]"
                  style={{ "--column-width": `${header.column.getSize()}px` }}
                >
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
      {footer}
    </CardFrame>
  );
};

interface AppRow {
  id: string;
  shortId: string;
  slug: string;
  name: string;
  scope: Scope;
  createdAt: Date | string;
  currentDeployment: { shortId: string; status: string } | null;
  deploymentCount: number;
  installationCount: number;
  logoPaths?: { dark?: string; light?: string };
}
