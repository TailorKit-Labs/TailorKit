const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;
export const formatFieldErrors = (issueors: unknown[] = []): string =>
  issueors
    .flatMap((issue) => {
      if (isStringValue(issue)) {
        return [issue];
      }

      if (
        isObjectValue(issue) &&
        issue !== null &&
        "message" in issue &&
        isStringValue(issue.message)
      ) {
        return [issue.message];
      }

      if (
        isObjectValue(issue) &&
        issue !== null &&
        "issues" in issue &&
        Array.isArray(issue.issues)
      ) {
        return [formatFieldErrors(issue.issues)];
      }

      if (
        isObjectValue(issue) &&
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
