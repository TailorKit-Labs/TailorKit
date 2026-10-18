import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import rootManifest from "../package.json" with { type: "json" };

const script = fileURLToPath(new URL("check-prerelease.mjs", import.meta.url));
const packageDirectories = [
  "tailorkit",
  "app",
  "app-db",
  "cli",
  "client-core",
  "client-platform",
  "core",
  "react",
  "sandbox",
  "vite",
];

/**
 * @param {string} directory Public package directory.
 * @param {string} version Package version to validate.
 */
const manifest = (directory, version) => ({
  name: directory === "tailorkit" ? directory : `@tailorkit/${directory}`,
  publishConfig: { access: "public" },
  repository: { url: "git+https://github.com/TailorKit-Labs/TailorKit.git" },
  version,
});

/**
 * @param {import("node:test").TestContext} context Test cleanup context.
 * @param {string} version Shared package version.
 * @param {string} tag Prerelease channel.
 */
const fixture = async (context, version = "0.1.0-beta.44", tag = "beta") => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-release-policy-"));
  context.after(async () => {
    await rm(root, { force: true, recursive: true });
  });
  await mkdir(path.join(root, ".changeset", "pre"), { recursive: true });
  await writeFile(
    path.join(root, ".changeset", "pre.json"),
    JSON.stringify({ mode: "pre", tag })
  );
  await Promise.all(
    packageDirectories.map(async (directory) => {
      const packagePath = path.join(root, "packages", directory);
      await mkdir(packagePath, { recursive: true });
      await writeFile(
        path.join(packagePath, "package.json"),
        JSON.stringify(manifest(directory, version))
      );
    })
  );
  return root;
};

/** @param {string} root Fixture directory to validate. */
const check = (root) =>
  spawnSync(process.execPath, [script], { cwd: root, encoding: "utf-8" });

for (const tag of ["alpha", "beta"]) {
  void test(`accepts aligned 0.x ${tag} prereleases without queued changesets`, async (context) => {
    const result = check(await fixture(context, `0.1.0-${tag}.44`, tag));
    assert.equal(result.status, 0, result.stderr);
  });
}

for (const version of [
  "1.0.0-beta.44",
  "2.0.0-alpha.0",
  "0.1.0",
  "0.1.0-rc.0",
  "0.1.0-beta.44-invalid",
  "0.1.0-beta.044",
]) {
  void test(`rejects forbidden package version ${version}`, async (context) => {
    const result = check(await fixture(context, version));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be a 0\.x alpha or beta prerelease/u);
  });
}

for (const directory of ["", "pre/"]) {
  void test(`rejects major bumps in .changeset/${directory}`, async (context) => {
    const root = await fixture(context);
    await writeFile(
      path.join(root, ".changeset", directory, "breaking.md"),
      "---\n'@tailorkit/client-platform': major\n---\n\nBreaking change.\n"
    );
    const result = check(root);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /requests a major bump for @tailorkit\/client-platform/u
    );
    assert.match(result.stderr, /use minor for breaking changes/u);
  });
}

void test("accepts minor and patch changesets including archived prerelease changes", async (context) => {
  const root = await fixture(context);
  await writeFile(
    path.join(root, ".changeset", "breaking.md"),
    '---\n"@tailorkit/client-platform": minor\n---\n\nBreaking prerelease change.\n'
  );
  await writeFile(
    path.join(root, ".changeset", "pre", "fix.md"),
    '---\n"tailorkit": patch\n---\n\nFix.\n'
  );
  const result = check(root);
  assert.equal(result.status, 0, result.stderr);
});

void test("rejects an invalid Changeset bump instead of silently skipping it", async (context) => {
  const root = await fixture(context);
  await writeFile(
    path.join(root, ".changeset", "invalid.md"),
    '---\n"tailorkit": invalid\n---\n\nInvalid bump.\n'
  );
  assert.notEqual(check(root).status, 0);
});

void test("rejects mismatched public package versions", async (context) => {
  const root = await fixture(context);
  await writeFile(
    path.join(root, "packages", "app", "package.json"),
    JSON.stringify(manifest("app", "0.1.0-beta.45"))
  );
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not share one version/u);
});

void test("rejects exiting prerelease mode", async (context) => {
  const root = await fixture(context);
  await writeFile(
    path.join(root, ".changeset", "pre.json"),
    JSON.stringify({ mode: "exit", tag: "beta" })
  );
  const result = check(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must remain in alpha or beta prerelease mode/u);
});

void test("the configured publish command works in prerelease mode", async (context) => {
  const root = await fixture(context);
  await Promise.all([
    writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "release-fixture", private: true })
    ),
    writeFile(
      path.join(root, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n"
    ),
    writeFile(
      path.join(root, ".changeset", "config.json"),
      JSON.stringify({ privatePackages: { tag: false, version: false } })
    ),
    // Private fixture packages exercise the real CLI without registry requests or publishing.
    ...packageDirectories.map(async (directory) => {
      await writeFile(
        path.join(root, "packages", directory, "package.json"),
        JSON.stringify({
          ...manifest(directory, "0.1.0-beta.44"),
          private: true,
        })
      );
    }),
  ]);

  const [, publishCommand] =
    rootManifest.scripts["release:publish"].split("vp exec changeset ");
  assert.ok(
    publishCommand !== undefined && publishCommand.length > 0,
    "The release script must invoke Changesets"
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@changesets/cli/bin.js")),
      ...publishCommand.trim().split(/\s+/u),
    ],
    { cwd: root, encoding: "utf-8", timeout: 30_000 }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No unpublished projects to publish/u);
});
