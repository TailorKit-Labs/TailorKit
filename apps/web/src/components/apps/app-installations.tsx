import { Button } from "@patchsmith/ui/button";
import { CardFrame } from "@patchsmith/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@patchsmith/ui/input-group";
import { useInfiniteQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "#lib/orpc";

import { AppsTable } from "./apps-table";

export const AppInstallations = ({
  appId,
  orgSlug,
  projectSlug,
}: {
  appId: string;
  orgSlug: string;
  projectSlug: string;
}) => {
  const [search, setSearch] = useState("");

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
  } = useInfiniteQuery(
    orpc.apps.listInstallations.infiniteOptions({
      getNextPageParam: (lastPage) =>
        lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
      initialPageParam: 1,
      input: (page) => ({
        appId,
        orgSlug,
        page,
        pageSize: 25,
        projectSlug,
        search: search.trim(),
      }),
    })
  );

  const installations = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-3">
      <InputGroup className="sm:max-w-80">
        <InputGroupInput
          aria-label="Search installations"
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Search installations by name, ID, or scope"
          type="search"
          value={search}
        />
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
      </InputGroup>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Unable to load installations. {error.message}
        </p>
      ) : null}
      {isPending || installations.length === 0 ? (
        <CardFrame>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            {isPending ? (
              "Loading installations..."
            ) : (
              <p>
                {search.trim()
                  ? "No installations match your search."
                  : "No installations yet. Installs of this app will appear here."}
              </p>
            )}
          </div>
        </CardFrame>
      ) : (
        <AppsTable
          apps={installations}
          kind="installations"
          orgSlug={orgSlug}
          projectSlug={projectSlug}
          footer={
            hasNextPage ? (
              <div className="border-t px-4 py-3 text-center">
                <Button
                  disabled={isFetchingNextPage}
                  onClick={() => {
                    void fetchNextPage();
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isFetchingNextPage
                    ? "Loading installations..."
                    : "Load more installations"}
                </Button>
              </div>
            ) : null
          }
        />
      )}
    </div>
  );
};
