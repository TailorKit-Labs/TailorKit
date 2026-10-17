# Releasing TailorKit

TailorKit uses Changesets to version packages, generate changelogs, publish to npm, and create Git tags and GitHub releases. Only `0.x` prereleases are enabled. The current channel is `beta`; the release policy accepts only `0.x` versions with a numeric `alpha` or `beta` suffix, such as `0.1.0-beta.44`.

## Add a change

Run `pnpm changeset`, select the affected public packages, choose the semantic versioning (SemVer) bump, and describe the user-facing change. Commit the generated Markdown file with the change.

Use `minor` for breaking changes while TailorKit remains on `0.x`. Major changesets are blocked, including those retained in `.changeset/pre`. Describe breaking changes and any migration steps in the changeset summary.

Changesets versions the public packages as one fixed group to keep their versions aligned. Backend and application-only workspace packages remain private.

## Publish a beta

After changes reach `main`, the `Prerelease` GitHub Actions workflow opens or updates a version PR. That PR contains the prerelease versions and generated `CHANGELOG.md` files. Review and merge it to publish packages under npm’s `beta` dist-tag and create GitHub releases.

Run `pnpm release:check` to check the release policy locally. CI and the release workflow run the same check. `pnpm release:version` checks before and after generating versions, and `pnpm release:publish` checks before building and publishing. These checks reject major changesets, versions outside `0.x`, stable releases, and mismatched versions in the fixed package group. Releasing `1.x` requires an explicit change to this policy first.

The publish command explicitly selects the `beta` dist-tag so Changesets cannot redirect beta-only packages to `latest`. If you intentionally switch to the `alpha` channel, update both `.changeset/pre.json` and the publish command’s `--tag` argument.

Publishing uses npm trusted publishing through GitHub OpenID Connect (OIDC). Each npm package trusts repository `tailorkit-labs/TailorKit`, workflow `release.yml`, and environment `npm-release`. The version PR job does not receive npm permissions; only the protected publish environment can request an identity token.

Do not run `changeset pre exit` while stable releases are disabled. The publish guard also rejects stable versions. `.changeset/pre.json` defines the active channel.
