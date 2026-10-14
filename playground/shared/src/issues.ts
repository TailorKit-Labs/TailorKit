import { and, asc, desc, eq } from "drizzle-orm";

import { db, issues, teams, users } from "./db";

export type IssueStatus = (typeof issues.$inferSelect)["status"];

export const listIssues = (teamId: string) =>
  db
    .select()
    .from(issues)
    .where(eq(issues.teamId, teamId))
    .orderBy(desc(issues.createdAt))
    .all();

export const getIssue = (teamId: string, issueId: string) =>
  db
    .select({ creatorName: users.name, issue: issues })
    .from(issues)
    .innerJoin(users, eq(issues.createdBy, users.id))
    .where(and(eq(issues.teamId, teamId), eq(issues.id, issueId)))
    .get();

export const getOverview = (teamId: string) => {
  const rows = listIssues(teamId);
  return {
    done: rows.filter((issue) => issue.status === "Done").length,
    inProgress: rows.filter((issue) => issue.status === "In Progress").length,
    recent: rows.slice(0, 5),
    total: rows.length,
  };
};

export const getTeam = (teamId: string) =>
  db.select().from(teams).where(eq(teams.id, teamId)).get();

export const listIssueKeys = (teamId: string) =>
  db
    .select({ key: issues.key })
    .from(issues)
    .where(eq(issues.teamId, teamId))
    .orderBy(asc(issues.createdAt))
    .all();

export const createIssue = (
  teamId: string,
  createdBy: string,
  title: string
) => {
  const team = getTeam(teamId);
  if (!team) {
    throw new Error("Team not found");
  }
  const keyNumber =
    listIssueKeys(teamId).filter(({ key }) => key.startsWith(`${team.key}-`))
      .length + 1;
  const issue = {
    createdAt: new Date(),
    createdBy,
    description: "",
    id: crypto.randomUUID(),
    key: `${team.key}-${keyNumber}`,
    status: "Backlog" as const,
    teamId,
    title,
  };
  db.insert(issues).values(issue).run();
  return issue;
};

export const updateIssueStatus = (
  teamId: string,
  issueId: string,
  status: IssueStatus
): typeof issues.$inferSelect | undefined => {
  const issue = db
    .select()
    .from(issues)
    .where(and(eq(issues.teamId, teamId), eq(issues.id, issueId)))
    .get();
  if (!issue) {
    return undefined;
  }
  db.update(issues).set({ status }).where(eq(issues.id, issueId)).run();
  return { ...issue, status };
};
