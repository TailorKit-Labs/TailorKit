import { getDemoSessionFromRequest } from "@playground/shared/auth";
import { contract } from "@playground/shared/contracts/active";
import { createServer } from "patchsmith/server";

import { env } from "#env";

export const patchSmith = createServer({
  $internal: {
    platformBaseUrl:
      env.PATCHSMITH_PLATFORM_BASE_URL ?? "http://localhost:3000/api/platform",
  },
  baseUrl: "http://localhost:5010/api/patchsmith",
  contract,
  projectKey: env.PATCHSMITH_PROJECT_KEY,
});

export const authenticatePatchsmithRequest = ({
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
