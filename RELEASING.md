# Releasing TailorKit

TailorKit uses Changesets to version packages, generate changelogs, publish to npm, and create Git tags and GitHub releases. Only prereleases are enabled. The current channel is `beta`; the publish job accepts only `alpha` and `beta` versions.

## Add a change

Run `pnpm changeset`, select the affected public packages, choose the semantic versioning (SemVer) bump, and describe the user-facing change. Commit the generated Markdown file with the change.

Changesets versions the public packages as one fixed group to keep their versions aligned. Backend and application-only workspace packages remain private.

## Publish a beta

After changes reach `main`, the `Prerelease` GitHub Actions workflow opens or updates a version PR. That PR contains the prerelease versions and generated `CHANGELOG.md` files. Review and merge it to publish packages under npm’s `beta` dist-tag and create GitHub releases.

Publishing uses npm trusted publishing through GitHub OpenID Connect (OIDC). Each npm package trusts repository `tailorkit-labs/TailorKit`, workflow `release.yml`, and environment `npm-release`. The version PR job does not receive npm permissions; only the protected publish environment can request an identity token.

Do not run `changeset pre exit` while stable releases are disabled. The publish guard also rejects stable versions. `.changeset/pre.json` defines the active channel.
