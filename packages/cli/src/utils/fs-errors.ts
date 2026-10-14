export const isMissingFile = <TCause>(
  cause: TCause
): cause is TCause & { code: "ENOENT" } =>
  cause !== null &&
  typeof cause === "object" &&
  "code" in cause &&
  cause.code === "ENOENT";
