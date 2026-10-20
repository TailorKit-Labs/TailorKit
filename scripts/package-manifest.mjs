/**
 * @typedef {Object} PackageManifest
 * @property {string} name name from the package manifest.
 * @property {string} version version from the package manifest.
 * @property {boolean | undefined} private private from the package manifest.
 * @property {string | undefined} license license from the package manifest.
 * @property {{access: string} | undefined} publishConfig publishConfig from the package manifest.
 * @property {{url: string} | undefined} repository repository from the package manifest.
 * @property {Record<string, string>} dependencies dependencies from the package manifest.
 * @property {Record<string, string>} optionalDependencies optionalDependencies from the package manifest.
 * @property {Record<string, string>} peerDependencies peerDependencies from the package manifest.
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */

const isRecord = (value) =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- JSON objects must be checked before reading their fields.
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value @returns {string | undefined} */

const optionalString = (value) =>
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Manifest fields must be checked at their JSON boundary.
  typeof value === "string" ? value : undefined;

/** @param {unknown} value @returns {Record<string, string>} */

const stringMap = (value) => {
  if (!isRecord(value)) {
    return {};
  }

  /** @type {Record<string, string>} */
  const result = {};

  for (const [name, range] of Object.entries(value)) {
    const parsed = optionalString(range);

    if (parsed === undefined) {
      throw new Error(`Dependency ${name} must have a string version range`);
    }

    result[name] = parsed;
  }

  return result;
};

/** @param {string} source @returns {PackageManifest} */
export const parsePackageManifest = (source) => {
  /** @type {unknown} */
  const value = JSON.parse(source);

  if (!isRecord(value)) {
    throw new Error("Package manifest must be an object");
  }

  return {
    dependencies: stringMap(value.dependencies),
    license: optionalString(value.license),
    name: optionalString(value.name) ?? "unnamed package",
    optionalDependencies: stringMap(value.optionalDependencies),
    peerDependencies: stringMap(value.peerDependencies),
    private: value.private === true,
    publishConfig: isRecord(value.publishConfig)
      ? { access: optionalString(value.publishConfig.access) ?? "" }
      : undefined,
    repository: isRecord(value.repository)
      ? { url: optionalString(value.repository.url) ?? "" }
      : undefined,
    version: optionalString(value.version) ?? "",
  };
};

/** @param {string} source @returns {{mode: string, tag: string}} */
export const parsePrereleaseState = (source) => {
  /** @type {unknown} */
  const value = JSON.parse(source);

  if (!isRecord(value)) {
    throw new Error("Changesets prerelease state must be an object");
  }

  return {
    mode: optionalString(value.mode) ?? "",
    tag: optionalString(value.tag) ?? "",
  };
};
