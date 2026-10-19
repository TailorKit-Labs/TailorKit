import { z } from "zod";

/** Read workflow credentials at invocation time, including after tests or shells change them. */
export const readAgentEnvironment = () => ({
  TAILORKIT_AGENT_TOKEN: process.env.TAILORKIT_AGENT_TOKEN,
  TAILORKIT_AGENT_TOKEN_FILE: process.env.TAILORKIT_AGENT_TOKEN_FILE,
});

const releaseAgeSchema = z
  .string()
  .trim()
  .min(1)
  .pipe(z.coerce.number<string>().int().min(0))
  .optional();

export const readInitEnvironment = () => ({
  minimumReleaseAge: releaseAgeSchema.parse(
    process.env.PNPM_CONFIG_MINIMUM_RELEASE_AGE
  ),
});

export const readInitInstallEnvironment = (
  minimumReleaseAge?: number
): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  if (minimumReleaseAge !== undefined) {
    environment.PNPM_CONFIG_MINIMUM_RELEASE_AGE = String(minimumReleaseAge);
  }
  return environment;
};
