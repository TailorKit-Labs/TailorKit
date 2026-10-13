const projectApiKeys = new Map<string, string>();

const projectApiKeyId = (orgSlug: string, projectSlug: string) =>
  `${orgSlug}:${projectSlug}`;

export const getProjectApiKey = (orgSlug: string, projectSlug: string) =>
  projectApiKeys.get(projectApiKeyId(orgSlug, projectSlug)) ?? null;

export const setProjectApiKey = (
  orgSlug: string,
  projectSlug: string,
  apiKey: string
) => {
  projectApiKeys.set(projectApiKeyId(orgSlug, projectSlug), apiKey);
};
