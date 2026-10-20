import { readFile } from "node:fs/promises";

import { readChangesets } from "@changesets/read";

import {
  parsePackageManifest,
  parsePrereleaseState,
} from "./package-manifest.mjs";

const publishablePackages = [
  "packages/patchsmith/package.json",
  "packages/ai-sdk/package.json",
  "packages/app/package.json",
  "packages/app-db/package.json",
  "packages/cli/package.json",
  "packages/client-core/package.json",
  "packages/client-platform/package.json",
  "packages/core/package.json",
  "packages/react/package.json",
  "packages/sandbox/package.json",
  "packages/vite/package.json",
];

const allowedPrerelease =
  /^0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-(?:alpha|beta)\.(?:0|[1-9]\d*)$/u;

const releaseRepository =
  // oxlint-disable-next-line no-restricted-properties -- The standalone release script reads GitHub Actions metadata.
  process.env.GITHUB_REPOSITORY ?? "tailorkit-labs/TailorKit";
const expectedRepositoryUrl = `git+https://github.com/${releaseRepository}.git`;
const errors = [];
const manifests = await Promise.all(
  publishablePackages.map(async (manifestPath) =>
    parsePackageManifest(await readFile(manifestPath, "utf-8"))
  )
);

for (const manifest of manifests) {
  if (manifest.private === true) {
    errors.push(`${manifest.name} is still private`);
  }

  if (!allowedPrerelease.test(manifest.version)) {
    errors.push(
      `${manifest.name}@${manifest.version} must be a 0.x alpha or beta prerelease`
    );
  }

  if (manifest.publishConfig?.access !== "public") {
    errors.push(`${manifest.name} does not publish with public access`);
  }

  if (
    manifest.repository?.url.toLowerCase() !==
    expectedRepositoryUrl.toLowerCase()
  ) {
    errors.push(
      `${manifest.name} repository.url must be ${expectedRepositoryUrl} for trusted publishing`
    );
  }
}

const publishableNames = new Set(manifests.map((manifest) => manifest.name));
const versions = new Set(manifests.map((manifest) => manifest.version));

if (versions.size !== 1) {
  errors.push("The fixed public package group does not share one version");
}

for (const manifest of manifests) {
  const publishedDependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };

  for (const [dependency, range] of Object.entries(publishedDependencies)) {
    if (range.startsWith("workspace:") && !publishableNames.has(dependency)) {
      errors.push(
        `${manifest.name} has an unpublished workspace dependency on ${dependency}`
      );
    }
  }
}

const preState = parsePrereleaseState(
  await readFile(".changeset/pre.json", "utf-8")
);

if (preState.mode !== "pre" || !["alpha", "beta"].includes(preState.tag)) {
  errors.push("Changesets must remain in alpha or beta prerelease mode");
}

for (const changeset of await readChangesets(process.cwd())) {
  for (const release of changeset.releases) {
    if (release.type === "major") {
      errors.push(
        `.changeset/${changeset.id}.md requests a major bump for ${release.name}; use minor for breaking changes while Patchsmith remains on 0.x`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Prerelease safety check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Prerelease safety check passed (${preState.tag} channel).`);
}
