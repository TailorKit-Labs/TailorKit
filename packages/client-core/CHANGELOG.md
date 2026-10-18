# @tailorkit/client-core

## 0.1.0-beta.46

### Patch Changes

- Updated dependencies [20947c7]
  - @tailorkit/app@0.1.0-beta.46
  - @tailorkit/sandbox@0.1.0-beta.46
  - @tailorkit/core@0.1.0-beta.46

## 0.1.0-beta.45

### Patch Changes

- @tailorkit/app@0.1.0-beta.45
  - @tailorkit/core@0.1.0-beta.45
  - @tailorkit/sandbox@0.1.0-beta.45

## 0.1.0-beta.44

### Patch Changes

- Restore the 0.x beta release line after the accidental 1.0.0-beta.44 release. This release includes the app slug and validation changes from that release; use 0.1.0-beta.44 instead of 1.0.0-beta.44.
- 1fb0155: Use Valibot for internal validation to reduce TailorKit bundle sizes. Accept user-provided Standard Schema validators for app functions and view instance data, preserving input/output inference and Zod primitive exports.
- Updated dependencies [89d328f]
- Updated dependencies
- Updated dependencies [1fb0155]
  - @tailorkit/core@0.1.0-beta.44
  - @tailorkit/app@0.1.0-beta.44
  - @tailorkit/sandbox@0.1.0-beta.44

## 1.0.0-beta.44

### Patch Changes

- 1fb0155: Use Valibot for internal validation to reduce TailorKit bundle sizes. Accept user-provided Standard Schema validators for app functions and view instance data, preserving input/output inference and Zod primitive exports.
- Updated dependencies [89d328f]
- Updated dependencies [1fb0155]
  - @tailorkit/core@1.0.0-beta.44
  - @tailorkit/app@1.0.0-beta.44
  - @tailorkit/sandbox@1.0.0-beta.44

## 0.1.0-beta.43

### Patch Changes

- Updated dependencies [6a68ba5]
  - @tailorkit/core@0.1.0-beta.43
  - @tailorkit/sandbox@0.1.0-beta.43
  - @tailorkit/app@0.1.0-beta.43

## 0.1.0-beta.42

### Minor Changes

- c54e0b1: Remove TailorKit app previews, including the `tailorkit preview` command, host preview consent and configuration, platform preview APIs and schemas, client preview metadata and stores, live revision subscriptions, and sandbox inline-source loading. Use deployed app builds for host integrations.

### Patch Changes

- Updated dependencies [c54e0b1]
  - @tailorkit/core@0.1.0-beta.42
  - @tailorkit/sandbox@0.1.0-beta.42
  - @tailorkit/app@0.1.0-beta.42

## 0.1.0-beta.41

### Patch Changes

- d4798f0: Render Pressable as an accessible div button that supports nested layout primitives, keyboard activation, focus indication, and disabled interaction styles. Keep interaction events in the host and send only the zero-argument onPress callback to the sandbox.
- @tailorkit/app@0.1.0-beta.41
  - @tailorkit/client-platform@0.1.0-beta.41
  - @tailorkit/core@0.1.0-beta.41
  - @tailorkit/sandbox@0.1.0-beta.41

## 0.1.0-beta.40

### Minor Changes

- b636758: Add a Pressable primitive with inline, box, flex, and grid layouts, token-based style props that combine breakpoint and interaction state values, and an onPress callback. The host renders a native button with keyboard activation and disabled behavior; interaction styling stays in the host.

  Replace the `base` style fallback with `default` across primitives. Style props continue to accept token strings and now support conditional objects with host-defined breakpoint names and `:hover`, `:active`, `:focus-visible`, and `:disabled` states. State values can contain breakpoint overrides. Breakpoint names `default` and all names starting with `:` are rejected by TypeScript and at runtime.

  Generate breakpoint and interaction types from serialized component fields, and preserve each property's authored breakpoint order. Breakpoint values require media-query widths; null fallback breakpoints and the generator's legacy `fieldKeys` schema fallback are no longer supported.

  Serialize repeated JSON Schema subtrees once in local `$defs` and reuse them through `$ref`, reducing schema payload size. Type generation resolves local references independently within component fields, callbacks, views, and tools, with explicit errors for unresolved, external, or circular references.

### Patch Changes

- Updated dependencies [b636758]
  - @tailorkit/core@0.1.0-beta.40
  - @tailorkit/sandbox@0.1.0-beta.40
  - @tailorkit/app@0.1.0-beta.40
  - @tailorkit/client-platform@0.1.0-beta.40

## 0.1.0-beta.39

### Patch Changes

- Updated dependencies [ad770d2]
  - @tailorkit/core@0.1.0-beta.39
  - @tailorkit/client-platform@0.1.0-beta.39
  - @tailorkit/sandbox@0.1.0-beta.39
  - @tailorkit/app@0.1.0-beta.39

## 0.1.0-beta.38

### Patch Changes

- Updated dependencies [469d8c2]
  - @tailorkit/core@0.1.0-beta.38
  - @tailorkit/sandbox@0.1.0-beta.38
  - @tailorkit/app@0.1.0-beta.38
  - @tailorkit/client-platform@0.1.0-beta.38

## 0.1.0-beta.37

### Patch Changes

- Updated dependencies [0d72562]
  - @tailorkit/core@0.1.0-beta.37
  - @tailorkit/app@0.1.0-beta.37
  - @tailorkit/sandbox@0.1.0-beta.37
  - @tailorkit/client-platform@0.1.0-beta.37

## 0.1.0-beta.36

### Patch Changes

- Updated dependencies [c0ce502]
  - @tailorkit/core@0.1.0-beta.36
  - @tailorkit/client-platform@0.1.0-beta.36
  - @tailorkit/sandbox@0.1.0-beta.36
  - @tailorkit/app@0.1.0-beta.36

## 0.1.0-beta.35

### Patch Changes

- @tailorkit/app@0.1.0-beta.35
  - @tailorkit/client-platform@0.1.0-beta.35
  - @tailorkit/core@0.1.0-beta.35
  - @tailorkit/sandbox@0.1.0-beta.35

## 0.1.0-beta.34

### Patch Changes

- Updated dependencies [82aa45f]
  - @tailorkit/core@0.1.0-beta.34
  - @tailorkit/client-platform@0.1.0-beta.34
  - @tailorkit/sandbox@0.1.0-beta.34
  - @tailorkit/app@0.1.0-beta.34

## 0.1.0-beta.33

### Patch Changes

- Updated dependencies [a215860]
  - @tailorkit/core@0.1.0-beta.33
  - @tailorkit/sandbox@0.1.0-beta.33
  - @tailorkit/app@0.1.0-beta.33
  - @tailorkit/client-platform@0.1.0-beta.33

## 0.1.0-beta.32

### Patch Changes

- Updated dependencies [1929607]
  - @tailorkit/client-platform@0.1.0-beta.32
  - @tailorkit/core@0.1.0-beta.32
  - @tailorkit/sandbox@0.1.0-beta.32
  - @tailorkit/app@0.1.0-beta.32

## 0.1.0-beta.31

### Patch Changes

- 4d2f904: Align source code with Ultracite’s default Oxlint and Oxfmt presets while preserving public APIs and runtime lifecycle behavior.
- Updated dependencies [4d2f904]
  - @tailorkit/app@0.1.0-beta.31
  - @tailorkit/client-platform@0.1.0-beta.31
  - @tailorkit/core@0.1.0-beta.31
  - @tailorkit/sandbox@0.1.0-beta.31

## 0.1.0-beta.30

### Patch Changes

- a79bf54: Omit the `children` renderer argument for components that do not support children and when no children are rendered.
- Updated dependencies [f8dce5d]
- Updated dependencies [29f3e30]
  - @tailorkit/app@0.1.0-beta.30
  - @tailorkit/sandbox@0.1.0-beta.30
  - @tailorkit/client-platform@0.1.0-beta.30
  - @tailorkit/core@0.1.0-beta.30

## 0.1.0-beta.29

### Patch Changes

- Updated dependencies [3567f94]
  - @tailorkit/core@0.1.0-beta.29
  - @tailorkit/sandbox@0.1.0-beta.29
  - @tailorkit/app@0.1.0-beta.29
  - @tailorkit/client-platform@0.1.0-beta.29

## 0.1.0-beta.28

### Patch Changes

- Updated dependencies [a0ffa4f]
  - @tailorkit/client-platform@0.1.0-beta.28
  - @tailorkit/core@0.1.0-beta.28
  - @tailorkit/sandbox@0.1.0-beta.28
  - @tailorkit/app@0.1.0-beta.28

## 0.1.0-beta.27

### Minor Changes

- 664a460: Allow `useViewContext` errors to be booleans, strings, or `Error` instances. Only `false`, `null`, and `undefined` mean no error; all strings, including an empty string, mark the view as failed. Errors continue to take precedence over loading and suppress context publication.
- 4685874: Remove the React provider's `subjectId` prop and subject-based cache partitioning and remounting. Providers share their client cache, and backend sessions are cached per app until renewal or an explicit refresh. Remove the session provider's subject cache key and the endpoint client's `setSubject` method; authenticated subject identity continues to come from the server.

  Expose `client.clearCache()` to clear shared app data and backend sessions after host authentication changes.

### Patch Changes

- Updated dependencies [21761f2]
- Updated dependencies [4685874]
  - @tailorkit/core@0.1.0-beta.27
  - @tailorkit/app@0.1.0-beta.27
  - @tailorkit/sandbox@0.1.0-beta.27
  - @tailorkit/client-platform@0.1.0-beta.27

## 0.1.0-beta.26

### Minor Changes

- 3fa95bc: Define shared browser-safe contracts with `defineContract` and `action().input().output()`. Use `createServer` from `tailorkit/server` to implement actions and `createClient` from `tailorkit/react` to infer component, view, slot, and scope types from the same contract.

  Host clients validate view context through the contract's original Standard Schema validators and publish the parsed output. Remove JSON Schema reconstruction and host `/meta` requests; resolve slots locally from the contract and accept an explicit client `assetsBaseUrl` for deployment URL fallbacks. Keep server metadata for app type generation, including scope schemas.

  Migrate existing server configuration into `defineContract`, move handlers and secrets to `createServer`, and replace the server type generic on React clients with a `contract` option.

  Contract actions without an input schema infer `undefined`; actions without an output schema infer `void`. Server implementations use the same contract return types, including `Promise<void>` for asynchronous handlers.

  Pass Valibot's `toJsonSchema` directly as the server `schemaSerializer`. Converters receive JSON Schema 2020-12 options, with `typeMode: "input"` for action inputs and `typeMode: "output"` for action results and other metadata; existing single-argument serializers remain supported.

### Patch Changes

- Updated dependencies [274ead8]
- Updated dependencies [3fa95bc]
  - @tailorkit/sandbox@0.1.0-beta.26
  - @tailorkit/core@0.1.0-beta.26
  - @tailorkit/app@0.1.0-beta.26
  - @tailorkit/client-platform@0.1.0-beta.26

## 0.1.0-beta.25

### Minor Changes

- 441a5a9: Rename `Slot` to `RenderSlot` (including client-bound `RenderSlot.Controlled`) and replace its `name` prop with `slot`. Rename the public types to `RenderSlotProps`, `ControlledRenderSlotProps`, `RuntimeRenderSlotProps`, `RenderSlotContext`, and `RenderSlotComponent`.

  Remove the standalone `Root` provider and its DOM/render props. Return a client-bound `Provider` from `createTailorKitClient`, accepting only `children` and `apps`, with the client supplied internally. Export it as `Provider: TailorKitProvider` alongside the hooks and `RenderSlot`, and wrap host components in `<TailorKitProvider>`. Export `TailorKitProviderProps` for the bound provider.

### Patch Changes

- Updated dependencies [441a5a9]
  - @tailorkit/app@0.1.0-beta.25
  - @tailorkit/sandbox@0.1.0-beta.25
  - @tailorkit/client-platform@0.1.0-beta.25
  - @tailorkit/core@0.1.0-beta.25

## 0.1.0-beta.24

### Minor Changes

- 4985d4e: Replace `useViewContext`'s status union with `{ context, loading?, error? }` so query data, loading, and errors can be passed together. Keep the view path as the first argument and infer the complete context type from that path. Loading defaults to false, errors take precedence, and loading/error states omit context. Update host examples to use the new API.

  Log diagnostics for ready views with missing required context or context that does not match the server's serialized JSON Schema. Allow omitted optional context, skip loading/error states, and suppress repeated errors for unchanged inputs. Reuse the existing Zod dependency to build JSON Schema context validators.

  Move context registration, status handling, equivalent-value deduplication, metadata observation, and diagnostics into the Nanostores-backed `client-core` view context store. Export shared context types so framework adapters can reuse the behavior. React only registers and unregisters context through its lifecycle effects. Remove React forwarding modules for slot and scope helpers and import them directly from `client-core`. Share view-query options and refetch coordination in `client-core`, including awaiting queries after app-discovery retries.

  Generalize remote view state in `client-core` with Nanostores for runtime status, component registrations, and node selectors. Share iframe lifecycle, prop updates, and callback binding across adapters, keep remote views isolated, and react to component renderer updates without recreating the sandbox.

  Use Nano Stores Async for cached fetching and task tracking, and expose cache snapshots as Nano Stores with immediate subscriber cleanup. Use the official React integration for all React store reads; the Preact adapter continues using the official Preact integration.

  Move app-query filtering and result flags, reactive view-query coordination, managed/controlled slot resolution, instance checks, client URL and remote-prop construction, component aliases and client configuration, server/slot types, and primitive/theme CSS generation into client-core. Framework adapters subscribe to shared stores and provide their own rendering and lifecycle handling. Remove the unused React context memo hook. Add a framework-independent app client connection entry point so client-core and the sandbox host do not load Preact through the app client entry point.

### Patch Changes

- Updated dependencies [057cfde]
- Updated dependencies [4985d4e]
  - @tailorkit/app@0.1.0-beta.24
  - @tailorkit/sandbox@0.1.0-beta.24
  - @tailorkit/core@0.1.0-beta.24
  - @tailorkit/client-platform@0.1.0-beta.24

## 0.1.0-beta.23

### Patch Changes

- @tailorkit/app@0.1.0-beta.23
  - @tailorkit/client-platform@0.1.0-beta.23
  - @tailorkit/core@0.1.0-beta.23
  - @tailorkit/sandbox@0.1.0-beta.23

## 0.1.0-beta.22

### Minor Changes

- 382f569: Replace `useSlotInstances` and `useViews` with `useSlot({ slot })`. Single-view slots return one `{ app }` item per app with an enabled, supported view, without requiring registered context or calling instance resolvers. Multiple-view slots retain context-based instance resolution and return `{ app, key, metadata, data }` items. Support app and scope filters, infer result types from the slot's multiple flag, and rename the shared slot store and cache configuration to match. Cache timings remain internal and are not exposed as hook options.

### Patch Changes

- c29880d: Replace TanStack Store with Nanostores for client fetch caches, preview sessions, view registration, and remote UI node state. Preserve change-only subscriptions, stable snapshots, and batched preview updates. Exposed local `state` stores now use the Nanostores atom API (`get`, `set`, and `listen`).

  Migrate app query, mutation, and action state to Nanostores with its Preact adapter. Preserve shared query subscriptions, selective updates, and protection against stale call results.

- Updated dependencies [c29880d]
- Updated dependencies [268df1e]
  - @tailorkit/app@0.1.0-beta.22
  - @tailorkit/sandbox@0.1.0-beta.22
  - @tailorkit/client-platform@0.1.0-beta.22
  - @tailorkit/core@0.1.0-beta.22

## 0.1.0-beta.21

### Patch Changes

- 1c52fe8: Add minimal package READMEs with readable names and short descriptions.
- Updated dependencies [1c52fe8]
  - @tailorkit/app@0.1.0-beta.21
  - @tailorkit/client-platform@0.1.0-beta.21
  - @tailorkit/core@0.1.0-beta.21
  - @tailorkit/sandbox@0.1.0-beta.21

## 0.1.0-beta.20

### Minor Changes

- e2de939: Add the framework-independent client-core package with TanStack Store-backed state and endpoint clients. Fetch stores for apps, metadata, slot instances, and preview sessions are separate from local view registration and remote UI node state. React uses shared response caching and in-flight request deduplication with configurable stale and retention times, while preserving its public app and view types.

### Patch Changes

- Updated dependencies [a2ed82b]
- Updated dependencies [fc09d5b]
  - @tailorkit/core@0.1.0-beta.20
  - @tailorkit/app@0.1.0-beta.20
  - @tailorkit/client-platform@0.1.0-beta.20
  - @tailorkit/sandbox@0.1.0-beta.20
