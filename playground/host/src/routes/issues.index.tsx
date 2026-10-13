import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tailorkit/ui/card";
import { Input } from "@tailorkit/ui/input";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowUpRight, Plus } from "lucide-react";
import { useState } from "react";

import { addIssue, loadIssues } from "#lib/issues.functions";

export const Route = createFileRoute("/issues/")({
  component: IssuesPage,
  loader: () => loadIssues(),
});

function IssuesPage() {
  const issues = Route.useLoaderData();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    if (!title.trim()) {
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const issue = await addIssue({ data: { title } });
      setTitle("");
      await router.navigate({
        params: { issueId: issue.id },
        to: "/issues/$issueId",
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not create issue"
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="text-muted-foreground mb-2 text-sm">Workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">Issues</h1>
        <p className="text-muted-foreground mt-2">
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
              onChange={(event) => setTitle(event.target.value)}
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
          {error ? (
            <p className="text-destructive mt-3 text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            All issues{" "}
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {issues.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {issues.map((issue) => (
            <Link
              className="group hover:bg-muted/60 flex items-center gap-3 rounded-lg px-3 py-3 transition-colors"
              key={issue.id}
              params={{ issueId: issue.id }}
              to="/issues/$issueId"
            >
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
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
                className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100"
              />
            </Link>
          ))}
          {issues.length === 0 ? (
            <p className="text-muted-foreground px-3 py-8 text-center text-sm">
              No issues yet. Create the first one above.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
