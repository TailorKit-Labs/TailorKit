import { Badge } from "@tailorkit/ui/badge";
import { Button } from "@tailorkit/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@tailorkit/ui/card";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Check, CircleDot } from "lucide-react";

import { changeIssueStatus, loadIssue } from "#lib/issues.functions";

export const Route = createFileRoute("/issues/$issueId")({
  component: IssueDetailPage,
  loader: ({ params }) => loadIssue({ data: { issueId: params.issueId } }),
});

function IssueDetailPage() {
  const { issue, creatorName } = Route.useLoaderData();
  const router = useRouter();
  const nextStatus =
    issue.status === "Backlog"
      ? "In Progress"
      : issue.status === "In Progress"
        ? "Done"
        : "Backlog";

  async function advanceStatus() {
    await changeIssueStatus({
      data: { issueId: issue.id, status: nextStatus },
    });
    await router.invalidate();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Button
        className="-ml-3 w-fit"
        render={<Link to="/issues" />}
        variant="ghost"
      >
        <ArrowLeft aria-hidden="true" />
        All issues
      </Button>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground font-mono text-sm">
          {issue.key}
        </span>
        <Badge variant={issue.status === "Done" ? "secondary" : "outline"}>
          {issue.status}
        </Badge>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">{issue.title}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {issue.description || "No description added."}
          </p>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Created by {creatorName}
        </p>
        <Button onClick={() => void advanceStatus()} variant="outline">
          {issue.status === "Done" ? (
            <CircleDot aria-hidden="true" />
          ) : (
            <Check aria-hidden="true" />
          )}
          {issue.status === "Done" ? "Reopen issue" : `Move to ${nextStatus}`}
        </Button>
      </div>
    </div>
  );
}
