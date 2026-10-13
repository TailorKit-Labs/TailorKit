export const formatFieldErrors = (issueors: unknown[] = []): string =>
  issueors
    .flatMap((issue) => {
      if (typeof issue === "string") {
        return [issue];
      }

      if (
        typeof issue === "object" &&
        issue !== null &&
        "message" in issue &&
        typeof issue.message === "string"
      ) {
        return [issue.message];
      }

      if (
        typeof issue === "object" &&
        issue !== null &&
        "issues" in issue &&
        Array.isArray(issue.issues)
      ) {
        return [formatFieldErrors(issue.issues)];
      }

      if (
        typeof issue === "object" &&
        issue !== null &&
        "issueors" in issue &&
        Array.isArray(issue.issueors)
      ) {
        return [formatFieldErrors(issue.issueors)];
      }

      return [String(issue)];
    })
    .map((formattedMessage) => formattedMessage.trim())
    .filter(Boolean)
    .join(", ");
