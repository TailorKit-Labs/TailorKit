import { and, eq } from "drizzle-orm";

import { db, teamMembers, teams, users } from "./db";

export const demoSessionCookie = "patchsmith_playground";

export type DemoUser = typeof users.$inferSelect;

export type DemoTeam = typeof teams.$inferSelect;

export interface DemoSession {
  user: DemoUser;
  team: DemoTeam;
}

export const listSignInChoices = () =>
  db
    .select({
      avatar: users.avatar,
      email: users.email,
      teamId: teams.id,
      teamKey: teams.key,
      teamName: teams.name,
      userId: users.id,
      userName: users.name,
    })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .all();

const getCookie = (cookieHeader: string | null, name: string) => {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return null;
};

export const getDemoSessionFromRequest = (
  request: Request
): DemoSession | null => {
  const value = getCookie(request.headers.get("cookie"), demoSessionCookie);
  if (!(value !== undefined && value !== null && value !== "")) {
    return null;
  }

  const [userId, teamId] = value.split(".");
  if (
    userId === undefined ||
    userId === "" ||
    teamId === undefined ||
    teamId === ""
  ) {
    return null;
  }

  const membership = db
    .select({ team: teams, user: users })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
    .get();

  return membership ?? null;
};

export const serializeDemoSessionCookie = (userId: string, teamId: string) =>
  `${demoSessionCookie}=${encodeURIComponent(`${userId}.${teamId}`)}; Path=/; HttpOnly; SameSite=Lax`;

export const clearDemoSessionCookie = () =>
  `${demoSessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
