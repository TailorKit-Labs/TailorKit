# Contributing to TailorKit

Thanks for helping improve TailorKit. This guide covers the repository workflow; product integration guidance lives in the [documentation](https://tailorkit.dev/docs).

## Set up the repository

TailorKit uses pnpm and Turborepo. Use the package manager version declared in the root `package.json`.

```sh
corepack enable
pnpm install
```

Run the platform app with:

```sh
pnpm dev
```

Run the documentation site with:

```sh
pnpm dev:docs
```

Some local development workflows use the Docker Compose services:

```sh
pnpm services:start
pnpm services:stop
```

Use `pnpm services:watch` to keep service logs attached, or `pnpm services:down` to stop and remove the local containers.

## Run checks

Before opening a pull request, run the checks relevant to your change:

```sh
pnpm check
pnpm check-types
pnpm test
pnpm build
```

`pnpm check` runs formatting and lint checks. License files are checked with:

```sh
pnpm licenses:check
```

## Make changes

- Keep changes focused and update tests or documentation when behavior changes.
- Add a changeset for changes to published packages with `pnpm changeset`.
- Run `pnpm licenses:sync` after changing a package license or canonical license text.
- Keep Apache-2.0 SDK/framework packages separate from BUSL-1.1 platform packages unless the licensing impact has been reviewed.

## Open a pull request

Include a short explanation of the problem and solution, the checks you ran, and screenshots or recordings for user-facing changes. Pull requests should be ready for review and should not include secrets, generated build output, or unrelated formatting changes.
