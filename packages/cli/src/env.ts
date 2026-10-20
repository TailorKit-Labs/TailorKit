/** Read workflow credentials at invocation time, including after tests or shells change them. */
export const readAgentEnvironment = () => ({
  PATCHSMITH_AGENT_TOKEN: process.env.PATCHSMITH_AGENT_TOKEN,
  PATCHSMITH_AGENT_TOKEN_FILE: process.env.PATCHSMITH_AGENT_TOKEN_FILE,
});
