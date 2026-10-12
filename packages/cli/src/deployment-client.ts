import { createCliClient } from "./client";
export { getAgentAuth } from "./agent-auth";

/** Preserve the host client for session credentials; JWTs use the shared platform adapter. */
export function createDeploymentClient(hostUrl: string, token: string) {
  return createCliClient({ url: hostUrl, token });
}
