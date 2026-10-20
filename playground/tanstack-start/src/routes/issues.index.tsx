import { Badge } from "@patchsmith/ui/badge";
import { Button } from "@patchsmith/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@patchsmith/ui/card";
import { Input } from "@patchsmith/ui/input";
import {
  useLoaderData,
  Link,
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import { ArrowUpRight, Plus } from "lucide-react";
import { useState } from "react";

import { addIssue, loadIssues } from "#lib/issues.functions";

const IssuesPage = () => {
  const issues = useLoaderData({ from: "/issues/" });
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState<string>();

  const create = async () => {
    if (!title.trim()) {
      return;
    }

    setPending(true);
    setOperationError(undefined);

    try {
      const issue = await addIssue({ data: { title } });
      setTitle("");
      await router.navigate({
        params: { issueId: issue.id },
        to: "/issues/$issueId",
      });
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "Could not create issue"
      );
      // oxlint-disable-next-line react/todo -- Oxlint’s React compiler does not support try/finally; cleanup must also run after failures.
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="mb-2 text-sm text-muted-foreground">Workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">Issues</h1>
        <p className="mt-2 text-muted-foreground">
          A small, shared list of work for your team.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create an issue</CardTitle>
          <CardDescription>Give the work a short, clear title.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Input
              aria-label="Issue title"
              maxLength={160}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              placeholder="What needs to be done?"
              value={title}
            />
            <Button
              disabled={!title.trim() || pending}
              loading={pending}
              type="submit"
            >
              <Plus aria-hidden="true" />
              Create issue
            </Button>
          </form>
          {operationError !== undefined &&
          operationError !== null &&
          operationError !== "" ? (
            <p className="mt-3 text-sm text-destructive" role="alert">
              {operationError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            All issues{" "}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {issues.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {issues.map((issue) => (
            <Link
              className="group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/60"
              key={issue.id}
              params={{ issueId: issue.id }}
              to="/issues/$issueId"
            >
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {issue.key}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {issue.title}
              </span>
              <Badge
                variant={issue.status === "Done" ? "secondary" : "outline"}
              >
                {issue.status}
              </Badge>
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              />
            </Link>
          ))}
          {issues.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No issues yet. Create the first one above.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/issues/")({
  component: IssuesPage,
  loader: async () => await loadIssues(),
});
