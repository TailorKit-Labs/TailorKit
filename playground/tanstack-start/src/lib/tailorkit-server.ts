import { createServer } from "tailorkit/server";
import { getDemoSessionFromRequest } from "@playground/shared/auth";
import { contract } from "@playground/shared/contracts/active";

export const tailorKit = createServer({
  contract,
  baseUrl: "http://localhost:5010/api/tailorkit",
  projectKey: process.env.TAILORKIT_PROJECT_KEY,
  $internal: {
    platformBaseUrl:
      process.env.TAILORKIT_PLATFORM_BASE_URL ?? "http://localhost:3000/api/platform",
  },
});

export function authenticateTailorKitRequest({ request }: { request: Request }) {
  const session = getDemoSessionFromRequest(request);
  if (!session) return null;
  return {
    subjectId: session.user.id,
    scopes: {
      user: { userId: session.user.id },
      team: { teamId: session.team.id },
    },
  };
}
