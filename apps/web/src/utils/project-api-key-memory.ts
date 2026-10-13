const projectApiKeys = new Map<string, string>();

function projectApiKeyId(orgSlug: string, projectSlug: string) {
  return `${orgSlug}:${projectSlug}`;
}

export function getProjectApiKey(orgSlug: string, projectSlug: string) {
  return projectApiKeys.get(projectApiKeyId(orgSlug, projectSlug)) ?? null;
}

export function setProjectApiKey(
  orgSlug: string,
  projectSlug: string,
  apiKey: string
) {
  projectApiKeys.set(projectApiKeyId(orgSlug, projectSlug), apiKey);
}
