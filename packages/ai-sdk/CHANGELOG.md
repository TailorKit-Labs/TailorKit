# @patchsmith/ai-sdk

## 0.1.0-beta.56

### Patch Changes

- Updated dependencies [74a7a6b]
  - @patchsmith/core@0.1.0-beta.56

## 0.1.0-beta.55

### Patch Changes

- Updated dependencies [7f5d15b]
  - @patchsmith/core@0.1.0-beta.55

## 0.1.0-beta.54

### Patch Changes

- Updated dependencies [d26ee48]
  - @patchsmith/core@0.1.0-beta.54

## 0.1.0-beta.53

### Minor Changes

- e96dce2: Rename TailorKit to Patchsmith. Install `patchsmith` and `@patchsmith/*` packages, replace `TailorKit`/`tailorkit` identifiers with `Patchsmith`/`patchsmith`, and use the `patchsmith` CLI. Rename `tailorkit.config.ts` to `patchsmith.config.ts`, regenerate app bindings with `patchsmith generate`, and update imports to `#patchsmith` and `src/patchsmith.gen.ts`.

  Move platform URLs to `https://patchsmith.io` and host integration routes to `/api/patchsmith`. Rename `TAILORKIT_*` environment variables to `PATCHSMITH_*`; app output and local credential directories now use `.patchsmith`. Sign in again after upgrading. Hosted app assets and RPC URLs continue to use `tailorkit.app`.

### Patch Changes

- f58b745: Add `createTools(patchsmith, { scopes, subjectId })` from `patchsmith/ai-sdk` to execute fixed definitions of the app agent's MCP tools with the AI SDK. Use Valibot for tool schemas and validation. Return destructurable `listApps`, `createApp`, and `editApp` tools while retaining snake_case MCP names internally. Stream MCP activity as preliminary tool results, preserve final structured results, and forward cancellation without replaying app changes.
- d799743: Update package repository links to `patchsmith-io/patchsmith`.
- Updated dependencies [d799743]
- Updated dependencies [e96dce2]
- Updated dependencies [1912070]
  - @patchsmith/core@0.1.0-beta.53
