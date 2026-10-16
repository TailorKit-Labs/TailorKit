# @tailorkit/cli

## 0.1.0-beta.40

### Minor Changes

- 677501e: Add optional `name` and `description` fields to `TailorKitConfig`. Deployment uses them for new apps and synchronizes configured fields on existing apps. Omitted fields preserve existing values; new apps fall back to the package or directory name and have no description. Set `description: null` to clear it.
- b636758: Add a Pressable primitive with inline, box, flex, and grid layouts, token-based style props that combine breakpoint and interaction state values, and an onPress callback. The host renders a native button with keyboard activation and disabled behavior; interaction styling stays in the host.

  Replace the `base` style fallback with `default` across primitives. Style props continue to accept token strings and now support conditional objects with host-defined breakpoint names and `:hover`, `:active`, `:focus-visible`, and `:disabled` states. State values can contain breakpoint overrides. Breakpoint names `default` and all names starting with `:` are rejected by TypeScript and at runtime.

  Generate breakpoint and interaction types from serialized component fields, and preserve each property's authored breakpoint order. Breakpoint values require media-query widths; null fallback breakpoints and the generator's legacy `fieldKeys` schema fallback are no longer supported.

  Serialize repeated JSON Schema subtrees once in local `$defs` and reuse them through `$ref`, reducing schema payload size. Type generation resolves local references independently within component fields, callbacks, views, and tools, with explicit errors for unresolved, external, or circular references.

### Patch Changes

- Updated dependencies [677501e]
- Updated dependencies [b636758]
  - @tailorkit/vite@0.1.0-beta.40
  - @tailorkit/core@0.1.0-beta.40
  - @tailorkit/client-platform@0.1.0-beta.40

## 0.1.0-beta.39

### Patch Changes

- Updated dependencies [ad770d2]
  - @tailorkit/core@0.1.0-beta.39
  - @tailorkit/client-platform@0.1.0-beta.39
  - @tailorkit/vite@0.1.0-beta.39

## 0.1.0-beta.38

### Minor Changes

- 469d8c2: Add optional slot descriptions for layout and sizing guidance. Preserve descriptions in serialized host contracts and include them in generated slot documentation for app authors and agents.

### Patch Changes

- Updated dependencies [469d8c2]
  - @tailorkit/core@0.1.0-beta.38
  - @tailorkit/client-platform@0.1.0-beta.38
  - @tailorkit/vite@0.1.0-beta.38

## 0.1.0-beta.37

### Patch Changes

- 1f6b983: Include the compiler command and TypeScript diagnostics when deployment stops after a failed type check, including non-interactive agent deployments.
- Updated dependencies [f2da040]
- Updated dependencies [0d72562]
  - @tailorkit/vite@0.1.0-beta.37
  - @tailorkit/core@0.1.0-beta.37
  - @tailorkit/client-platform@0.1.0-beta.37

## 0.1.0-beta.36

### Patch Changes

- c0ce502: Restrict the agent command to apps created by AI, validate explicit app IDs, and mark apps created through the authenticated agent creation flow as AI-created. Reject caller-supplied provenance on general app creation.
- Updated dependencies [c0ce502]
  - @tailorkit/core@0.1.0-beta.36
  - @tailorkit/client-platform@0.1.0-beta.36
  - @tailorkit/vite@0.1.0-beta.36

## 0.1.0-beta.35

### Patch Changes

- @tailorkit/client-platform@0.1.0-beta.35
  - @tailorkit/core@0.1.0-beta.35
  - @tailorkit/vite@0.1.0-beta.35

## 0.1.0-beta.34

### Minor Changes

- 82aa45f: Reconnect interrupted agent streams to the existing workflow from the last received chunk, and settle a disconnected turn before sending a follow-up. Relay signed run identities and cleanup completion through the host API.

  Agent chat requires explicit turn or resume requests. Combine thread and run identity in `data-run`, and require `data-run-complete` after workspace cleanup. Remove the separate `data-thread` event and finish-only success handling.

  The app agent checkpoints SDK state directly instead of collecting duplicate model messages. MCP returns the assembled assistant `message` from the output stream instead of a `messages` array.

### Patch Changes

- Updated dependencies [82aa45f]
  - @tailorkit/core@0.1.0-beta.34
  - @tailorkit/client-platform@0.1.0-beta.34
  - @tailorkit/vite@0.1.0-beta.34

## 0.1.0-beta.33

### Patch Changes

- Updated dependencies [a215860]
  - @tailorkit/core@0.1.0-beta.33
  - @tailorkit/client-platform@0.1.0-beta.33
  - @tailorkit/vite@0.1.0-beta.33

## 0.1.0-beta.32

### Minor Changes

- 1929607: Start a new agent conversation for each CLI invocation by default. Follow-up messages reuse its thread, and `tailorkit agent --thread <id>` explicitly resumes a previous conversation. Add optional `threadId` to the chat protocol and return thread metadata in the stream.

### Patch Changes

- Updated dependencies [1929607]
  - @tailorkit/client-platform@0.1.0-beta.32
  - @tailorkit/core@0.1.0-beta.32
  - @tailorkit/vite@0.1.0-beta.32

## 0.1.0-beta.31

### Patch Changes

- 4d2f904: Align source code with Ultracite’s default Oxlint and Oxfmt presets while preserving public APIs and runtime lifecycle behavior.
- Updated dependencies [4d2f904]
  - @tailorkit/client-platform@0.1.0-beta.31
  - @tailorkit/core@0.1.0-beta.31
  - @tailorkit/vite@0.1.0-beta.31

## 0.1.0-beta.30

### Minor Changes

- 29f3e30: Move the complete build pipeline and configuration loading into `@tailorkit/vite`. Build TailorKit apps with the public `tailorkit()` plugin from `tailorkit/vite`. Init now offers Vite+ (recommended, with linting, formatting and testing) or Vite (build only), with one `vite.config.ts` for app tooling. Deploy builds using the app's Vite configuration and installation.

  Remove `tailorkit build`, `buildApp()`, the init lint/format flags, and build settings in `tailorkit.config.ts`. Set `build.outDir` in `vite.config.ts` instead.

### Patch Changes

- Updated dependencies [29f3e30]
  - @tailorkit/vite@0.1.0-beta.30
  - @tailorkit/client-platform@0.1.0-beta.30
  - @tailorkit/core@0.1.0-beta.30

## 0.1.0-beta.29

### Patch Changes

- 108aaa9: Let the app agent publish through existing platform endpoints using a one-hour JWT as an alternative to CLI sessions across authenticated commands, using the same project/scope permissions and existing platform endpoints. Preserve normal session-token login, storage, and host routing. Require secure platform URLs, distinguish service failures from auth rejection, and add headless deployment and explicit app selection.
- Updated dependencies [3567f94]
  - @tailorkit/core@0.1.0-beta.29
  - @tailorkit/app@0.1.0-beta.29
  - @tailorkit/client-platform@0.1.0-beta.29

## 0.1.0-beta.28

### Patch Changes

- a0ffa4f: Send the host URL and a fresh schema snapshot with each CLI agent turn so the remote agent can scaffold and generate bindings against an undeployed local host. Add `--schema <path>` to init and generate for generation from a serialized JSON schema file. Agent workflows require a host URL and accept an optional schema; host-only runs continue fetching the schema normally.
- Updated dependencies [a0ffa4f]
  - @tailorkit/client-platform@0.1.0-beta.28
  - @tailorkit/core@0.1.0-beta.28
  - @tailorkit/app@0.1.0-beta.28

## 0.1.0-beta.27

### Patch Changes

- be8bce2: Require an explicit --host URL for the agent command instead of reading or writing tailorkit.config.ts. Keep --app optional for selecting an existing remote app, remove --cwd from the agent command, and support --host for login, logout, and whoami.
- Updated dependencies [21761f2]
- Updated dependencies [4685874]
  - @tailorkit/core@0.1.0-beta.27
  - @tailorkit/app@0.1.0-beta.27
  - @tailorkit/client-platform@0.1.0-beta.27

## 0.1.0-beta.26

### Patch Changes

- Updated dependencies [3fa95bc]
  - @tailorkit/core@0.1.0-beta.26
  - @tailorkit/app@0.1.0-beta.26
  - @tailorkit/client-platform@0.1.0-beta.26

## 0.1.0-beta.25

### Patch Changes

- Updated dependencies [441a5a9]
  - @tailorkit/app@0.1.0-beta.25
  - @tailorkit/client-platform@0.1.0-beta.25
  - @tailorkit/core@0.1.0-beta.25

## 0.1.0-beta.24

### Minor Changes

- 057cfde: Scaffold app databases in `src/db` with schema, relations and a `defineDatabase` export. Generate migrations in `src/db/migrations`, support typed synchronous Drizzle relational queries in database handlers.

  Discover app views from `src/slots/<slot-name>/*.view.tsx`, with dotted filenames mapping to nested routes and optional explicit view paths. Add `defineRoute({ shellComponent })` roots and nested slot layouts with a `Route` outlet, preserving shared layout state during navigation. Init generates a root shell with `ClientProvider`.

  Remove manual `defineClient` registration, `client.entry` configuration, and fallback discovery of `src/schema.ts` and root migrations. Apps use the file-based client and `src/db` database layout exclusively.

  Update sandbox diagnostics to describe the generated app client instead of the removed manual client API.

### Patch Changes

- Updated dependencies [057cfde]
- Updated dependencies [4985d4e]
  - @tailorkit/app@0.1.0-beta.24
  - @tailorkit/core@0.1.0-beta.24
  - @tailorkit/client-platform@0.1.0-beta.24

## 0.1.0-beta.23

### Patch Changes

- @tailorkit/app@0.1.0-beta.23
  - @tailorkit/client-platform@0.1.0-beta.23
  - @tailorkit/core@0.1.0-beta.23

## 0.1.0-beta.22

### Minor Changes

- 268df1e: Require Preact 11 for app builds and newly scaffolded apps. Keep provider disposal and pending-call cancellation synchronous during unmount with layout-effect cleanup.

### Patch Changes

- Updated dependencies [c29880d]
- Updated dependencies [268df1e]
  - @tailorkit/app@0.1.0-beta.22
  - @tailorkit/client-platform@0.1.0-beta.22
  - @tailorkit/core@0.1.0-beta.22

## 0.1.0-beta.21

### Patch Changes

- 1c52fe8: Add minimal package READMEs with readable names and short descriptions.
- Updated dependencies [1c52fe8]
  - @tailorkit/app@0.1.0-beta.21
  - @tailorkit/client-platform@0.1.0-beta.21
  - @tailorkit/core@0.1.0-beta.21

## 0.1.0-beta.20

### Minor Changes

- a2ed82b: Declare multi-instance host slots with `multiple: true` (omitted or false means single-instance). Client-bound `Slot` requires `instanceKey` for multi-instance slots and rejects it for single-instance slots; ready `Slot.Controlled` similarly requires or rejects `instance`.

  Breaking change: rename `createView` to `defineView`, use `defineView({ slot, view, component, ... })` and regenerate app bindings. Multi-instance slots require `instances: { dataSchema, resolve }`; single-instance slots reject it. View registration is restricted to the slot selected in `defineView`. The CLI scaffolds a resolver when the selected host slot supports multiple instances.

### Patch Changes

- fc09d5b: Gzip client and server deployment bundles before uploading to reduce transfer and R2 storage. Record compressed byte checksums and sizes, and support gzip deployment metadata while retaining compatibility with uncompressed deployments.

  Raise the maximum client and server bundle size to 3 MiB for uploads and decoded runtime/delivery bytes.

- Updated dependencies [a2ed82b]
- Updated dependencies [fc09d5b]
  - @tailorkit/core@0.1.0-beta.20
  - @tailorkit/app@0.1.0-beta.20
  - @tailorkit/client-platform@0.1.0-beta.20

## 0.1.0-beta.19

### Minor Changes

- fa05f02: Add colocated `createView` instance resolvers with a validated data schema and automatic, typed access to registered server queries. The app build uses Oxc to extract resolvers and their dependencies into generated server actions through `_tailorkit.instances.resolve`, addressed by slot and view path, keeping their implementations out of browser bundles. Hosts discover instance support through `instances: true` in deployment and preview view manifests.
- fa05f02: Add client-bound useViews with scopes, appIds, and slot filters. App builds and deployments include view manifests, including preview builds. useApps and useViews share one authenticated app request and filter locally; useApps also accepts appIds. Apps without a view manifest must be redeployed to appear in useViews.

### Patch Changes

- fa05f02: Add client-bound `useSlotInstances({ app, slot })` to fetch instances through the authenticated app action endpoint using the matching view and registered ancestor context. Expose loading, errors, and refetch; clear stale data when context or deployment changes. Preserve disabled view paths in manifests so host matching respects blocked fallback, while keeping them out of `useViews` discovery.
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
- Updated dependencies [fa05f02]
  - @tailorkit/app@0.1.0-beta.19
  - @tailorkit/core@0.1.0-beta.19
  - @tailorkit/client-platform@0.1.0-beta.19

## 0.1.0-beta.18

### Patch Changes

- fc9538d: Allow the agent command to search existing apps or create a new app when appId is omitted, then save the chosen app ID in the TailorKit config for future launches.
- 6f969e3: Add `tailor agent` (also available as `tailorkit agent`), an AI SDK terminal chat interface for the platform app agent. Relay messages through authenticated host oRPC routes and the generated OpenAPI client. Keep conversation history in CLI memory while remote code persists on the app's exclusively mounted Sandbox Drive.
- Updated dependencies [fc9538d]
- Updated dependencies [6f969e3]
- Updated dependencies [731e066]
  - @tailorkit/app@0.1.0-beta.18
  - @tailorkit/core@0.1.0-beta.18
  - @tailorkit/client-platform@0.1.0-beta.18

## 0.1.0-beta.17

### Patch Changes

- 364d5cd: Document TailorKitConfig options and their defaults in editor tooltips, and generate new app configs with only the host URL so the backend is enabled explicitly.
- 72d38cd: Start the login approval flow automatically when deploying without valid credentials, then continue the deployment in the same command after approval.
- 8d1b465: Include TailorKit light and dark logo SVGs in apps created by the init command and configure both logo paths so new apps have branding ready for preview and deployment.
- aad1587: Generate host bindings during init and scaffold the first supported view alphabetically in a matching slot. Use Box when available, otherwise a fragment, and avoid assuming host context fields or components.
- d586115: Preserve nullable types, discriminated unions, records, and tuples in generated view contexts, component props, callbacks, and actions. Accept the JSON Schema keywords emitted for integers, records, and tuples.
- 6569f26: Enable skipLibCheck in generated app TypeScript configs so dependency declaration errors do not block deployment while application code remains type checked.
- 9384481: Persist appId in the default-exported top-level config object, including typed declarations and the satisfies TailorKitConfig format generated by init, without modifying nested variables with the same name.
- Updated dependencies [ba00155]
- Updated dependencies [364d5cd]
- Updated dependencies [d586115]
  - @tailorkit/core@0.1.0-beta.17
  - @tailorkit/client-platform@0.1.0-beta.17
  - @tailorkit/app@0.1.0-beta.17

## 0.1.0-beta.16

### Minor Changes

- b5c6afc: Consolidate the app SDK in @tailorkit/app and expose app client APIs through tailorkit/client and server APIs through tailorkit/server. Provide SQLite schema builders, synchronous Zod-validated queries/mutations, asynchronous external actions, atomic mutation receipts and typed browser references. Use oRPC v2 HTTP for direct sandbox calls and WebSockets for server-driven query snapshots; the bridge supplies scoped platform JWTs and renews authentication. Execute queries, mutations and actions in one private Cloudflare facet, with an ALS-backed fetch guard and local action query/mutation calls and scoped capabilities for HTTPS egress. Keep synchronous database transactions atomic. Actions do not retry automatically or hold database transactions across external work. Track table dependencies and rerun only active affected queries after commit.

  Upload client and private server bundles with committed Drizzle migrations to separate blob prefixes and load published code into isolated Dynamic Worker SQLite facets through apps/apps-worker. Keep stable installation databases across deployments, trusted Effect v4 coordination, and client-only app compatibility. Store migration sources in migrations/ and copy them to .tailorkit/migrations/. Generate migrations explicitly through tailorkit db generate using Drizzle Kit and the existing TailorKit config, without a separate Drizzle config; builds check the current schema against the latest saved snapshot without rewriting history. Apply pending migrations atomically to each installation before database calls.

  Retire the legacy app-storage SDK, app-platform package, storage CLI commands and bridged database calls. Keep the Apache-2.0 oRPC contract in @tailorkit/app/protocol and execution in the private BUSL-1.1 apps-worker worker. Share private app JWT signing/verification through @tailorkit/api-utils/app-auth, and expose host authorization through backend.resolveInstallation and /backend/session. Effect stays in server auth and trusted runtime code, outside browser entry points.

  Support client.entry and server.entry in tailorkit.config.ts, defaulting to src/client.ts and src/server.ts. Build, deployment type checks, browser/server isolation and API type imports follow the configured entries.

  Share duplicate reactive queries with TanStack Store and retry transient mutation failures with stable receipt IDs. Inline dynamic server imports into one upload, typecheck both app entries, preserve session error codes through the iframe bridge, and mount opaque-origin sandboxes without waiting for backend authentication. Cache published deployment metadata in Cloudflare KV, update it through an authenticated platform-to-worker endpoint, and populate cache misses through the platform API. Existing clients reconnect to the latest server without remounting; deployments must maintain client compatibility.

### Patch Changes

- Updated dependencies [14980bc]
- Updated dependencies [b5c6afc]
- Updated dependencies [efdac76]
  - @tailorkit/core@0.1.0-beta.16
  - @tailorkit/client-platform@0.1.0-beta.16
  - @tailorkit/app@0.1.0-beta.16

## 0.1.0-beta.15

### Patch Changes

- @tailorkit/app@0.1.0-beta.15
  - @tailorkit/client-platform@0.1.0-beta.15
  - @tailorkit/core@0.1.0-beta.15

## 0.1.0-beta.14

### Patch Changes

- e06e450: Upload complete preview builds to KV in bounded oRPC chunks, accept previews through a host consent page, and stream verified revisions to sandboxed app views.
- 9a8ecab: Avoid logging expected request-stream aborts while the preview tunnel reconnects.
- Updated dependencies [e06e450]
  - @tailorkit/core@0.1.0-beta.14
  - @tailorkit/client-platform@0.1.0-beta.14
  - @tailorkit/app@0.1.0-beta.14

## 0.1.0-beta.13

### Patch Changes

- 061adb2: Serve preview assets directly through the authenticated tunnel without starting a local HTTP server, and end preview sessions when the CLI exits or cannot establish its tunnel.
- Updated dependencies [061adb2]
  - @tailorkit/client-platform@0.1.0-beta.13
  - @tailorkit/core@0.1.0-beta.13
  - @tailorkit/app@0.1.0-beta.13

## 0.1.0-beta.12

### Patch Changes

- @tailorkit/app@0.1.0-beta.12
  - @tailorkit/client-platform@0.1.0-beta.12
  - @tailorkit/core@0.1.0-beta.12

## 0.1.0-beta.11

### Patch Changes

- 54eb091: Use a typed oRPC WebSocket client for local preview tunnels and generate the platform HTTP client from the OpenAPI schema.
- Updated dependencies [54eb091]
  - @tailorkit/client-platform@0.1.0-beta.11
  - @tailorkit/core@0.1.0-beta.11
  - @tailorkit/app@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- a0d3233: Add authenticated local preview tunnels with bounded asset delivery and secure host-side asset proxying.
- Updated dependencies [a0d3233]
  - @tailorkit/core@0.1.0-beta.10
  - @tailorkit/app@0.1.0-beta.10

## 0.1.0-beta.9

### Minor Changes

- ced9f2f: Add slot-specific app view selection and layered host views. Host contracts now declare `views` and `slots`; app clients register `slots[name][path]`. Each slot selects one matching view and composes context only from that view and its ancestors. Unsupported matches render nothing, and `false` entries stop fallback.

  React integrations now import `Root`, `AppView`, `useApps`, and `useView` directly. Pass the client to `Root`, add a slot to every app view, publish only each view's own context, and regenerate app bindings. Registries are isolated per root.

  Each slot declares a `views` list typed against the global view definitions. Generated app bindings and explicit host mounts enforce the slot-to-view relationship, and runtime matching only considers supported view paths while retaining inherited ancestor context.

  Publish host view state with `useView(path, { context })` or `useView(path, { status })`.

  The iframe runtime is bundled from TypeScript and accepts only default-exported `defineClient()` clients. Demo clients use that same contract. View ancestry is shared between React, the sandbox, and generated bindings. `Root` supplies one app-discovery state: when `apps` is provided, `useApps()` reads it and skips network discovery.

### Patch Changes

- Updated dependencies [ced9f2f]
  - @tailorkit/app@0.1.0-beta.9
  - @tailorkit/core@0.1.0-beta.9

## 0.1.0-beta.8

### Patch Changes

- Updated dependencies [9e46a8b]
  - @tailorkit/app@0.1.0-beta.8
  - @tailorkit/core@0.1.0-beta.8

## 0.1.0-beta.7

### Patch Changes

- 2e7b3a4: Add optional light and dark app logos to the deployment pipeline, including validated SVG, PNG, and WebP uploads, hosted logo URLs, and a 1 MiB combined client asset limit.
- Updated dependencies [2e7b3a4]
  - @tailorkit/app@0.1.0-beta.7
  - @tailorkit/core@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- @tailorkit/app@0.1.0-beta.6
  - @tailorkit/core@0.1.0-beta.6

## 0.1.0-beta.5

### Patch Changes

- Updated dependencies [695cdad]
  - @tailorkit/core@0.1.0-beta.5
  - @tailorkit/app@0.1.0-beta.5

## 0.1.0-beta.4

### Patch Changes

- 324b281: Resolve public packages to compiled distribution files in both development and production, without custom source export conditions.

  Remove stale source aliases and declaration maps that reference unpublished source files. Generate apps with a single tailorkit dependency and its app subpath exports.

- Updated dependencies [324b281]
  - @tailorkit/app@0.1.0-beta.4
  - @tailorkit/core@0.1.0-beta.4

## 0.1.0-beta.3

### Patch Changes

- Updated dependencies [a02ebee]
  - @tailorkit/app@0.1.0-beta.3
  - @tailorkit/core@0.1.0-beta.3

## 0.1.0-beta.2

### Patch Changes

- Updated dependencies [586cc14]
  - @tailorkit/core@0.1.0-beta.2
  - @tailorkit/app@0.1.0-beta.2

## 0.1.0-beta.1

### Patch Changes

- Updated dependencies [c0bdd68]
  - @tailorkit/core@0.1.0-beta.1
  - @tailorkit/app@0.1.0-beta.1

## 0.1.0-beta.0

### Minor Changes

- 4230689: Publish the initial TailorKit beta packages.

### Patch Changes

- Updated dependencies [4230689]
  - @tailorkit/app@0.1.0-beta.0
  - @tailorkit/core@0.1.0-beta.0
