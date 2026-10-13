import { getDemoSessionFromRequest } from "@playground/shared/auth";
import {
  createIssue,
  getIssue,
  getOverview,
  listIssues,
  updateIssueStatus,
} from "@playground/shared/issues";
import type { IssueStatus } from "@playground/shared/issues";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

function requireSession() {
  const session = getDemoSessionFromRequest(getRequest());
  if (!session) {
    throw new Error("Sign in to continue");
  }
  return session;
}

export const loadOverview = createServerFn({ method: "GET" }).handler(() => {
  const { team } = requireSession();
  return getOverview(team.id);
});

export const loadIssues = createServerFn({ method: "GET" }).handler(() => {
  const { team } = requireSession();
  return listIssues(team.id);
});

export const loadIssue = createServerFn({ method: "GET" })
  .validator((data: { issueId: string }) => data)
  .handler(({ data }) => {
    const { team } = requireSession();
    const result = getIssue(team.id, data.issueId);
    if (!result) {
      throw new Error("Issue not found");
    }
    return result;
  });

export const addIssue = createServerFn({ method: "POST" })
  .validator(z.object({ title: z.string().trim().min(1).max(160) }))
  .handler(({ data }) => {
    const session = requireSession();
    return createIssue(session.team.id, session.user.id, data.title);
  });

export const changeIssueStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({
      issueId: z.string(),
      status: z.enum(["Backlog", "In Progress", "Done"]),
    })
  )
  .handler(({ data }) => {
    const { team } = requireSession();
    const issue = updateIssueStatus(
      team.id,
      data.issueId,
      data.status as IssueStatus
    );
    if (!issue) {
      throw new Error("Issue not found");
    }
    return issue;
  });
