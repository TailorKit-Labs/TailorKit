/** Host-only adapter configuration and sandbox access. */
export { appAgentSettings } from "./app-settings";
export type { AppAgentInput } from "./input";
export { getSandbox, networkSession, removeLegacyAgentToken } from "./sandbox";
export { renewSession } from "./session-store";
export { threadSandboxName } from "./identity";
