export const appendScopeSelection = (
  url: URL,
  scopes?: readonly string[]
): void => {
  if (scopes === undefined) {
    return;
  }

  if (scopes.length === 0) {
    url.searchParams.append("scopes", "");

    return;
  }

  for (const scope of scopes) {
    url.searchParams.append("scopes", scope);
  }
};

export interface ScopeSelection {
  key: string;
  scopes?: readonly string[];
}

export const normalizeScopeSelection = (
  scopes?: readonly string[]
): ScopeSelection => {
  if (scopes === undefined) {
    return { key: "*" };
  }

  const names = [...new Set(scopes)].toSorted();

  return { key: JSON.stringify(names), scopes: names };
};
