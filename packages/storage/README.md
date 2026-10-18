# TailorKit storage

`@tailorkit/storage` implements shared file storage for the TailorKit platform.

`getStorage()` and `createS3CompatibleStorage()` return synchronously. The S3 implementation, AWS SDK, and storage telemetry load on the first storage operation. Concurrent operations share initialization, and each adapter reuses its S3 client. Initialization failures reject the operation and clear the adapter's cached promise.

## Measure the bundle

From the repository root:

```sh
pnpm exec turbo run build --filter=@tailorkit/storage
pnpm --filter @tailorkit/storage measure:bundle
```

The measurement bundles the built package's root entry for Node using Vite+ with minification and code splitting. It retains all public exports and bundles AWS and Zod. `@tailorkit/env` and `@tailorkit/observability` stay external, matching the web app's shared server packages. Their transitive code is excluded from these figures. Source maps and declarations are also excluded.

`initial` counts the entry and its recursive static imports. `total` includes every emitted JavaScript chunk, including dynamic imports. Gzip figures sum the compressed size of each chunk separately.

Measured against `fb16b044` with the same lockfile versions and measurement script:

- Initial JavaScript: 317,585 → 69,161 bytes, a 78.2% reduction.
- Initial gzip: 105,342 → 19,885 bytes, an 81.1% reduction.
- Total JavaScript: 431,266 → 431,249 bytes.
- Total gzip: 146,233 → 146,671 bytes.

This reduces the initial storage dependency graph. The full deployment still contains the SDK, and the first storage operation pays the deferred import cost. Consumers must preserve dynamic imports as separate chunks to get the bundle benefit.
