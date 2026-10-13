import {
  clearDemoSessionCookie,
  getDemoSessionFromRequest,
  listSignInChoices,
  serializeDemoSessionCookie,
} from "@playground/shared/auth";
import { createFileRoute } from "@tanstack/react-router";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return Response.json(data, { ...init, headers });
}

async function handle({ request }: { request: Request }) {
  if (request.method === "GET") {
    return json({ session: getDemoSessionFromRequest(request), choices: listSignInChoices() });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    userId?: string;
    teamId?: string;
  } | null;

  if (body?.action === "sign-out") {
    return json(
      { session: null, choices: listSignInChoices() },
      { headers: { "Set-Cookie": clearDemoSessionCookie() } },
    );
  }

  if (body?.action !== "sign-in" || !body.userId || !body.teamId) {
    return json({ error: "Choose a profile and team" }, { status: 400 });
  }

  const choice = listSignInChoices().find(
    (item) => item.userId === body.userId && item.teamId === body.teamId,
  );
  if (!choice) return json({ error: "That profile is not a member of this team" }, { status: 400 });

  return json(
    {
      session: {
        user: {
          id: choice.userId,
          name: choice.userName,
          email: choice.email,
          avatar: choice.avatar,
        },
        team: { id: choice.teamId, name: choice.teamName, key: choice.teamKey },
      },
      choices: listSignInChoices(),
    },
    { headers: { "Set-Cookie": serializeDemoSessionCookie(choice.userId, choice.teamId) } },
  );
}

export const Route = createFileRoute("/api/auth")({
  server: { handlers: { GET: handle, POST: handle } },
});
