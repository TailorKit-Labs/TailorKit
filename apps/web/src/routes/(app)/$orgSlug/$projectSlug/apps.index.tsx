import type { Scope } from "@tailorkit/db/schema/scope";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { CardFrame } from "@tailorkit/ui/card";
import { DateAgo } from "@tailorkit/ui/date";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tailorkit/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@tailorkit/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tailorkit/ui/table";
import { useInfiniteQuery } from "@tanstack/react-query";
/* oxlint-disable react/no-unstable-nested-components */
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { flexRender, useTable } from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { AppWindowIcon, ArrowUpRightIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { AppLogo } from "#components/apps/app-logo";
import { renderSortableHeader } from "#components/members/member-table-utils";
import { PageLayout } from "#components/page-layout";
import { ProjectKeyEnv } from "#components/project-key-env";
import { orpc } from "#lib/orpc";
import { dataTableFeatures } from "#lib/table";
import { getProjectApiKey } from "#utils/project-api-key-memory";

const appsPageSize = 25;

const appsListQueryOptions = ({
  appsList,
  orgSlug,
  projectSlug,
  search,
}: {
  appsList: typeof orpc.apps.list;
  orgSlug: string;
  projectSlug: string;
  search: string;
}) =>
  appsList.infiniteOptions({
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    initialPageParam: 1,
    input: (page) => ({
      orgSlug,
      page,
      pageSize: appsPageSize,
      projectSlug,
      search,
    }),
  });

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

const AppsTable = ({
  apps,
  hasNextPage,
  isFetchingNextPage,
  loadMoreRef,
  orgSlug,
  projectSlug,
}: {
  apps: AppRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  orgSlug: string;
  projectSlug: string;
}) => {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([
    { desc: true, id: "createdAt" },
  ]);

  const columns = useMemo<ColumnDef<typeof dataTableFeatures, AppRow>[]>(
    () => [
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
              <span className="truncate text-sm font-medium">
                {row.original.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {row.original.publicId}
              </span>
            </div>
          </div>
        ),
        header: "App",
        size: 280,
      },
      {
        accessorFn: (row) =>
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
        size: 220,
      },
      {
        accessorKey: "deploymentCount",
        cell: ({ row }) => (
          <span className="text-sm">{row.original.deploymentCount}</span>
        ),
        header: "Deployments",
        size: 120,
      },
      {
        cell: ({ row }) =>
          row.original.currentDeployment ? (
            <Badge
              size="lg"
              variant={getDeploymentStatusVariant(
                row.original.currentDeployment.status
              )}
            >
              {row.original.currentDeployment.status}
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">None</span>
          ),
        header: "Current",
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
    ],
    []
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
            <TableRow
              className="cursor-pointer"
              key={row.id}
              tabIndex={0}
              onClick={() => {
                void (async () => {
                  await navigate({
                    params: {
                      appId: row.original.publicId,
                      orgSlug,
                      projectSlug,
                    },
                    to: "/$orgSlug/$projectSlug/apps/$appId",
                  });
                })();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void navigate({
                    params: {
                      appId: row.original.publicId,
                      orgSlug,
                      projectSlug,
                    },
                    to: "/$orgSlug/$projectSlug/apps/$appId",
                  });
                }
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(isFetchingNextPage || hasNextPage) && (
        <div
          ref={loadMoreRef}
          className="border-t px-4 py-3 text-center text-sm text-muted-foreground"
        >
          {isFetchingNextPage ? "Loading more apps..." : "Scroll for more apps"}
        </div>
      )}
    </CardFrame>
  );
};

const AppsIndexPage = () => {
  const { orgSlug, projectSlug } = useParams({
    from: "/(app)/$orgSlug/$projectSlug/apps/",
  });
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim();
  const projectApiKey = getProjectApiKey(orgSlug, projectSlug);
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } =
    useInfiniteQuery(
      appsListQueryOptions({
        appsList: orpc.apps.list,
        orgSlug,
        projectSlug,
        search: normalizedSearch,
      })
    );

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    if (!loadMoreElement || !hasNextPage) {
      /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        !isFetchingNextPage
      ) {
        void fetchNextPage();
      }
    });

    observer.observe(loadMoreElement);

    return () => {
      observer.disconnect();
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const apps = data?.pages.flatMap((page) => page.items) ?? [];
  const isEmptyProject = !isPending && !normalizedSearch && apps.length === 0;
  const searchControl = (
    <div className="relative w-full sm:w-72">
      <InputGroup>
        <InputGroupInput
          placeholder="Search apps"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
  let content;

  if (isPending) {
    content = (
      <CardFrame className="w-full text-center">
        <div className="px-4 py-6 text-sm text-muted-foreground">
          Loading apps...
        </div>
      </CardFrame>
    );
  } else if (
    apps.length === 0 &&
    !normalizedSearch &&
    projectApiKey !== undefined &&
    projectApiKey !== null &&
    projectApiKey !== ""
  ) {
    content = <ProjectKeyEnv key={projectApiKey} apiKey={projectApiKey} />;
  } else if (apps.length === 0) {
    content = (
      <Empty className="mx-auto w-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AppWindowIcon />
          </EmptyMedia>
          <EmptyTitle>
            {normalizedSearch ? "No apps found" : "No apps uploaded"}
          </EmptyTitle>
          <EmptyDescription>
            {normalizedSearch
              ? "Try a different app name, id, scope, or description."
              : "Apps deployed to this project will appear here."}
          </EmptyDescription>
        </EmptyHeader>
        {normalizedSearch ? null : (
          <EmptyContent>
            <Button
              render={
                <a
                  aria-label="Read the installation guide"
                  href="https://tailorkit.dev/docs/installation"
                  rel="noopener noreferrer"
                  target="_blank"
                />
              }
              size="sm"
              variant="outline"
            >
              Installation guide
              <ArrowUpRightIcon aria-hidden="true" />
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  } else {
    content = (
      <AppsTable
        apps={apps}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
      />
    );
  }

  return (
    <PageLayout
      actions={isEmptyProject ? undefined : searchControl}
      description={
        isEmptyProject
          ? "No apps yet. Set up TailorKit to deploy your first app."
          : "Apps uploaded to this project through TailorKit."
      }
      title="Apps"
    >
      {content}
    </PageLayout>
  );
};

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug/apps/")({
  component: AppsIndexPage,
  loader: async ({ context, params }) =>
    await context.queryClient.infiniteQuery(
      appsListQueryOptions({
        appsList: context.orpc.apps.list,
        orgSlug: params.orgSlug,
        projectSlug: params.projectSlug,
        search: "",
      })
    ),
});

interface AppRow {
  id: string;
  publicId: string;
  name: string;
  scope: Scope;
  createdAt: Date | string;
  currentDeployment: { status: string } | null;
  deploymentCount: number;
  logoPaths?: { dark?: string; light?: string };
}
