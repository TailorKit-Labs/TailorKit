import { Button } from "@patchsmith/ui/button";
import { CardFrame } from "@patchsmith/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@patchsmith/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@patchsmith/ui/input-group";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { AppWindowIcon, ArrowUpRightIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppsTable } from "#components/apps/apps-table";
import { PageLayout } from "#components/page-layout";
import { ProjectKeyEnv } from "#components/project-key-env";
import { orpc } from "#lib/orpc";
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

  useEffect((): (() => void) | undefined => {
    const loadMoreElement = loadMoreRef.current;

    if (!loadMoreElement || !hasNextPage) {
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
          aria-label="Search apps"
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
              ? "Try a different app name, slug, id, scope, or description."
              : "Apps deployed to this project will appear here."}
          </EmptyDescription>
        </EmptyHeader>
        {normalizedSearch ? null : (
          <EmptyContent>
            <Button
              render={
                <a
                  aria-label="Read the installation guide"
                  href="https://patchsmith.io/docs/installation"
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
        footer={
          isFetchingNextPage || hasNextPage ? (
            <div
              ref={loadMoreRef}
              className="border-t px-4 py-3 text-center text-sm text-muted-foreground"
            >
              {isFetchingNextPage
                ? "Loading more apps..."
                : "Scroll for more apps"}
            </div>
          ) : null
        }
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
          ? "No apps yet. Set up Patchsmith to deploy your first app."
          : "All apps in this project. Open an app to see its installations and deployments."
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
