import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@tailorkit/ui/card";
import { useLoaderData, Link, createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, CircleCheck, CircleDot, Plus } from "lucide-react";

import { loadOverview } from "#lib/issues.functions";

const OverviewPage = () => {
  const overview = useLoaderData({ from: "/" });
  const stats = [
    {
      icon: CircleDot,
      label: "Open issues",
      value: overview.total - overview.done,
    },
    { icon: ArrowUpRight, label: "In progress", value: overview.inProgress },
    { icon: CircleCheck, label: "Completed", value: overview.done },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Team overview</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Your team’s work
          </h1>
          <p className="mt-2 text-muted-foreground">
            A quick look at what your team is working on.
          </p>
        </div>
        <Button render={<Link to="/issues" />}>
          <Plus aria-hidden="true" />
          View issues
        </Button>
      </div>

      <section aria-label="Issue summary" className="grid gap-4 sm:grid-cols-3">
        {stats.map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardDescription>{label}</CardDescription>
              <Icon
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{value}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Recently updated</CardTitle>
            <CardDescription className="mt-1">
              The latest work across your team.
            </CardDescription>
          </div>
          <Button render={<Link to="/issues" />} size="sm" variant="ghost">
            All issues
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {overview.recent.length ? (
            overview.recent.map((issue) => (
              <Link
                className="flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/60"
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
              </Link>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No issues yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/")({
  component: OverviewPage,
  loader: async () => await loadOverview(),
});
