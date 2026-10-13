# TailorKit docs

Pages are written in MDX and organized in `docs.json`.

## Local preview

From the repository root, run:

```sh
pnpm dev:docs
```

The Mintlify CLI prints the preview URL. To choose a port, run `pnpm exec mint dev --port 3003` from this directory.

## SDK references

The type declarations at the bottom of the capability pages are extracted from SDK source into reusable Mintlify snippets in `snippets/sdk/`.

After changing SDK types, regenerate them from the repository root:

```sh
pnpm docs:reference
pnpm docs:reference:check
```

Edit `scripts/generate-docs-reference.mjs` if a source declaration moves. Keep the field descriptions and examples in each page aligned with the generated types.

## Validate

From this directory:

```sh
pnpm exec mint validate
pnpm exec mint broken-links
```
