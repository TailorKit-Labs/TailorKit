# TailorKit docs

Pages are written in MDX and organized in `docs.json`.

## Local preview

From the repository root, run:

```sh
pnpm docs:reference
pnpm dev:docs
```

The Mintlify CLI prints the preview URL. To choose a port, run `pnpm exec mint dev --port 3003` from this directory.

## SDK references

TypeDoc reads the declarations exported by `sdk-entry.ts` and writes `sdk-artifacts/typescript.json`. Mintlify reads that artifact through the `sdk` configuration in `docs.json`. It renders the SDK reference pages and appends each guide's selected symbol using `sdk` frontmatter.

After changing SDK types, regenerate and commit the artifact:

```sh
pnpm docs:reference
```

Check that the committed artifact is current:

```sh
pnpm docs:reference:check
```

The check runs in CI. Add exports to `sdk-entry.ts` when another symbol needs documentation. TypeDoc options live in the repository's `typedoc.json`.

## Validate

From this directory:

```sh
pnpm exec mint validate
pnpm exec mint broken-links
```

## PR previews

Mintlify creates a preview for an open PR targeting the configured deployment branch. The Vercel web preview rewrites `/docs/*` to the production Mintlify site; use the Mintlify preview link to review docs changes.

If the Mintlify check says "No eligible deployments found for changes," no docs build was attempted. Check the connected repository, deployment branch, `docs/` content root, and preview settings in Mintlify.
