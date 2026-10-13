import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowUpRight, Plus } from "lucide-react";
import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@tailorkit/ui/card";
import { Input } from "@tailorkit/ui/input";
import { addIssue, loadIssues } from "#lib/issues.functions";

export const Route = createFileRoute("/issues")({
  loader: () => loadIssues(),
  component: IssuesPage,
});

function IssuesPage() {
  const issues = Route.useLoaderData();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    if (!title.trim()) return;
    setPending(true);
    setError(undefined);
    try {
      const issue = await addIssue({ data: { title } });
      setTitle("");
      await router.navigate({ to: "/issues/$issueId", params: { issueId: issue.id } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create issue");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-7">
      <div>
        <p className="mb-2 text-muted-foreground text-sm">Workspace</p>
        <h1 className="font-semibold text-3xl tracking-tight">Issues</h1>
        <p className="mt-2 text-muted-foreground">A small, shared list of work for your team.</p>
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
            <Button disabled={!title.trim() || pending} loading={pending} type="submit">
              <Plus aria-hidden="true" />
              Create issue
            </Button>
          </form>
          {error ? (
            <p className="mt-3 text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            All issues{" "}
            <span className="ml-2 font-normal text-muted-foreground text-sm">{issues.length}</span>
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
              <span className="shrink-0 font-mono text-muted-foreground text-xs">{issue.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{issue.title}</span>
              <Badge variant={issue.status === "Done" ? "secondary" : "outline"}>
                {issue.status}
              </Badge>
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
              />
            </Link>
          ))}
          {issues.length === 0 ? (
            <p className="px-3 py-8 text-center text-muted-foreground text-sm">
              No issues yet. Create the first one above.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
