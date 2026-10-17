# TailorKit platform client

`@tailorkit/client-platform` is the API client for the TailorKit platform.

Apps have an immutable `slug`, unique within their project across all scopes. Slugs contain 1–32 lowercase letters or digits, separated by single hyphens. Set `slug` when creating an app or installation; omitting it generates a stable slug consisting of `app-` followed by 28 random hexadecimal characters. Renaming an app does not change its slug. Duplicate slugs return `CONFLICT`.

App operations take an explicit `app` selector containing exactly one of `{ id }` (UUID), `{ shortId }`, or `{ slug }`. Identifier namespaces never fall back to one another. Project credentials and scope authorization still apply to every lookup.

With a configured `client` and authorized `scope`:

```ts
import { appsCreate, appsGet } from "@tailorkit/client-platform";

await appsCreate({
  body: {
    description: null,
    name: "Shared inbox",
    scope,
    slug: "shared-inbox",
  },
  client,
});

const inbox = await appsGet({
  body: { app: { slug: "shared-inbox" }, scopes: [scope] },
  client,
});
```

This is a breaking platform contract change: app lookup, update, delete, deploy, install, and runtime-session operations now send `app` in the body to `/apps/lookup`, `/apps/update`, `/apps/delete`, `/apps/deploy`, `/apps/install`, and `/apps/runtime/session` respectively, using POST. Deployment creation/listing and agent chat also use the `app` selector. Deployment identifiers and the internal runtime bundle endpoint remain unchanged. Upgrade the platform client and host/CLI packages together with the backend.
