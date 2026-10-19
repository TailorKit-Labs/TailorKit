import { z } from "zod";

import packageJson from "#package.json" with { type: "json" };

export interface TemplatePackageVersions {
  drizzleKit: string;
  drizzleOrm: string;
  vite: string;
  vitePlus?: string;
  preact: string;
  tailorkit: string;
  typescript: string;
  zod: string;
}

// Match the SDK's supported Drizzle v1 snapshot format and runtime version.
export const TEMPLATE_DRIZZLE_VERSION = "1.0.0-rc.4-5d5b77c";

interface PackageVersionRequest {
  fallback: string;
  matcher: string;
  packageName: string;
}

interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

const REGISTRY_URL = "https://registry.npmjs.org";
const REGISTRY_TIMEOUT_MS = 5000;
export const DEFAULT_MINIMUM_RELEASE_AGE = 3 * 24 * 60;

const REQUESTS = {
  preact: { fallback: "11.0.0", matcher: "^11", packageName: "preact" },
  typescript: { fallback: "6.0.3", matcher: "^6", packageName: "typescript" },
  vite: { fallback: "8.0.0", matcher: "^8", packageName: "vite" },
  vitePlus: { fallback: "1.0.0", matcher: "^1", packageName: "vite-plus" },
  zod: { fallback: "4.0.0", matcher: "^4", packageName: "zod" },
} satisfies Record<
  Exclude<
    keyof TemplatePackageVersions,
    "drizzleKit" | "drizzleOrm" | "tailorkit"
  >,
  PackageVersionRequest
>;

const parseStableVersion = (version: string): SemverVersion | undefined => {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(version);
  if (!match?.groups) {
    return undefined;
  }
  const { major, minor, patch } = match.groups;
  if (
    !(major !== undefined && major !== null && major !== "") ||
    !(minor !== undefined && minor !== null && minor !== "") ||
    !(patch !== undefined && patch !== null && patch !== "")
  ) {
    return undefined;
  }
  return {
    major: Math.trunc(Number(major)),
    minor: Math.trunc(Number(minor)),
    patch: Math.trunc(Number(patch)),
    raw: version,
  };
};

const compareVersions = (a: SemverVersion, b: SemverVersion): number => {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
};

const satisfiesCaretMatcher = (
  version: SemverVersion,
  matcher: string
): boolean => {
  const match = /^\^(?<major>\d+)(?:\.(?<minor>\d+))?/u.exec(matcher);
  if (
    !(
      match?.groups?.major !== undefined &&
      match?.groups?.major !== null &&
      match?.groups?.major !== ""
    )
  ) {
    return false;
  }
  const minMajor = Math.trunc(Number(match.groups.major));
  const minMinor = Math.trunc(Number(match.groups.minor ?? "0"));
  return version.major === minMajor && version.minor >= minMinor;
};

const resolvePackageVersion = async ({
  fallback,
  matcher,
  packageName,
}: PackageVersionRequest): Promise<string> => {
  try {
    const res = await fetch(
      `${REGISTRY_URL}/${encodeURIComponent(packageName)}`,
      {
        signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      return fallback;
    }
    const data = z
      .object({
        time: z.record(z.string(), z.string()).optional(),
        versions: z.record(z.string(), z.object({}).loose()).optional(),
      })
      .parse(await res.json());
    const latest = Object.keys(data.versions ?? {})
      .map(parseStableVersion)
      .filter((v): v is SemverVersion => v !== undefined)
      .filter((v) => satisfiesCaretMatcher(v, matcher))
      .filter(
        (v) =>
          Date.parse(data.time?.[v.raw] ?? "") <=
          Date.now() - DEFAULT_MINIMUM_RELEASE_AGE * 60_000
      )
      .toSorted(compareVersions)
      .at(-1);
    return latest?.raw ?? fallback;
  } catch {
    return fallback;
  }
};

export const resolveTemplatePackageVersions = async (
  tooling: "vite-plus" | "vite" = "vite-plus"
): Promise<TemplatePackageVersions> => {
  const [vite, vitePlus, preact, typescript, zod] = await Promise.all([
    tooling === "vite"
      ? resolvePackageVersion(REQUESTS.vite)
      : Promise.resolve(REQUESTS.vite.fallback),
    tooling === "vite-plus"
      ? resolvePackageVersion(REQUESTS.vitePlus)
      : undefined,
    resolvePackageVersion(REQUESTS.preact),
    resolvePackageVersion(REQUESTS.typescript),
    resolvePackageVersion(REQUESTS.zod),
  ]);
  return {
    drizzleKit: TEMPLATE_DRIZZLE_VERSION,
    drizzleOrm: TEMPLATE_DRIZZLE_VERSION,
    preact,
    tailorkit: packageJson.version,
    typescript,
    vite,
    vitePlus,
    zod,
  };
};
