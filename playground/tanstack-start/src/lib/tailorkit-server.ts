import { getDemoSessionFromRequest } from "@playground/shared/auth";
import { contract } from "@playground/shared/contracts/active";
import { createServer } from "tailorkit/server";

import { env } from "#env";

export const tailorKit = createServer({
  $internal: {
    platformBaseUrl:
      env.TAILORKIT_PLATFORM_BASE_URL ?? "http://localhost:3000/api/platform",
  },
  baseUrl: "http://localhost:5010/api/tailorkit",
  contract,
  projectKey: env.TAILORKIT_PROJECT_KEY,
});

export const authenticateTailorKitRequest = ({
  request,
}: {
  request: Request;
}) => {
  const session = getDemoSessionFromRequest(request);
  if (!session) {
    return null;
  }
  return {
    scopes: {
      team: { teamId: session.team.id },
      user: { userId: session.user.id },
    },
    subjectId: session.user.id,
  };
};
