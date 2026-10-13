import { createCliClient } from "./client";

export { getAgentAuth } from "./agent-auth";

/** Preserve the host client for session credentials; JWTs use the shared platform adapter. */
export const createDeploymentClient = (hostUrl: string, token: string) =>
  createCliClient({ token, url: hostUrl });
