/** Read workflow credentials at invocation time, including after tests or shells change them. */
export const readAgentEnvironment = () => ({
  TAILORKIT_AGENT_TOKEN: process.env.TAILORKIT_AGENT_TOKEN,
  TAILORKIT_AGENT_TOKEN_FILE: process.env.TAILORKIT_AGENT_TOKEN_FILE,
});
