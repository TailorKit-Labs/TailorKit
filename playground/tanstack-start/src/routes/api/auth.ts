import {
  clearDemoSessionCookie,
  getDemoSessionFromRequest,
  listSignInChoices,
  serializeDemoSessionCookie,
} from "@playground/shared/auth";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const json = <T>(data: T, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return Response.json(data, { ...init, headers });
};

const handle = async ({ request }: { request: Request }) => {
  if (request.method === "GET") {
    return json({
      choices: listSignInChoices(),
      session: getDemoSessionFromRequest(request),
    });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }
  const parsed = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("sign-out") }),
      z.object({
        action: z.literal("sign-in"),
        userId: z.string().min(1),
        teamId: z.string().min(1),
      }),
    ])
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Choose a profile and team" }, { status: 400 });
  }
  const body = parsed.data;

  if (body.action === "sign-out") {
    return json(
      { choices: listSignInChoices(), session: null },
      { headers: { "Set-Cookie": clearDemoSessionCookie() } }
    );
  }

  const choice = listSignInChoices().find(
    (item) => item.userId === body.userId && item.teamId === body.teamId
  );
  if (!choice) {
    return json(
      { error: "That profile is not a member of this team" },
      { status: 400 }
    );
  }

  return json(
    {
      choices: listSignInChoices(),
      session: {
        team: { id: choice.teamId, key: choice.teamKey, name: choice.teamName },
        user: {
          avatar: choice.avatar,
          email: choice.email,
          id: choice.userId,
          name: choice.userName,
        },
      },
    },
    {
      headers: {
        "Set-Cookie": serializeDemoSessionCookie(choice.userId, choice.teamId),
      },
    }
  );
};

export const Route = createFileRoute("/api/auth")({
  server: { handlers: { GET: handle, POST: handle } },
});
