import { and, eq } from "drizzle-orm";

import { db, teamMembers, teams, users } from "./db";

export const demoSessionCookie = "tailorkit_playground";

export type DemoUser = typeof users.$inferSelect;
export type DemoTeam = typeof teams.$inferSelect;
export interface DemoSession {
  user: DemoUser;
  team: DemoTeam;
}

export function listSignInChoices() {
  return db
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
}

export function getDemoSessionFromRequest(
  request: Request
): DemoSession | null {
  const value = getCookie(request.headers.get("cookie"), demoSessionCookie);
  if (!value) {
    return null;
  }

  const [userId, teamId] = value.split(".");
  if (!userId || !teamId) {
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
}

export function serializeDemoSessionCookie(userId: string, teamId: string) {
  return `${demoSessionCookie}=${encodeURIComponent(`${userId}.${teamId}`)}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearDemoSessionCookie() {
  return `${demoSessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function getCookie(cookieHeader: string | null, name: string) {
  for (const part of cookieHeader?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return null;
}
