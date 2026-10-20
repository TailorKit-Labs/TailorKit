# @patchsmith/client-core

## 0.1.0-beta.52

### Minor Changes

- 1fa87fe: Remove legacy session and CLI credential shapes. App sessions now require complete identity metadata, including `identity.subjectId` and `identity.toolUrl`; remove the duplicate top-level subject from host responses and the duplicate top-level tool URL from platform responses. The host forwards the platform session without synthesizing a subject. Share the session validator with the iframe protocol so complete authenticated sessions reach sandboxed apps.

  Custom session providers must return `{ expiresAt, identity, token, url }` with a complete identity. Stored CLI credentials must contain a named scope; delete obsolete entries from `~/.patchsmith/auth.json` and log in again to replace flat-scope or scopeless credentials.

### Patch Changes

- Updated dependencies [1fa87fe]
  - @patchsmith/app@0.1.0-beta.52
  - @patchsmith/core@0.1.0-beta.52
  - @patchsmith/sandbox@0.1.0-beta.52

## 0.1.0-beta.51

### Patch Changes

- Updated dependencies [8cbc3d5]
- Updated dependencies [38e1ced]
  - @patchsmith/core@0.1.0-beta.51
  - @patchsmith/app@0.1.0-beta.51
  - @patchsmith/sandbox@0.1.0-beta.51

## 0.1.0-beta.50

### Minor Changes

- 71fc3a7: Return component callback results across the sandbox bridge instead of dropping them. Callback definitions use only input and output schemas. App callbacks accept direct or promised results, and every host callback returns a promise, including callbacks without an output schema. Callback failures, sandbox destruction, and a 30-second timeout reject pending results.

### Patch Changes

- Updated dependencies [71fc3a7]
  - @patchsmith/core@0.1.0-beta.50
  - @patchsmith/app@0.1.0-beta.50
  - @patchsmith/sandbox@0.1.0-beta.50

## 0.1.0-beta.49

### Patch Changes

- @patchsmith/app@0.1.0-beta.49
  - @patchsmith/core@0.1.0-beta.49
  - @patchsmith/sandbox@0.1.0-beta.49

## 0.1.0-beta.48

### Patch Changes

- Updated dependencies [6a5c17a]
  - @patchsmith/app@0.1.0-beta.48
  - @patchsmith/sandbox@0.1.0-beta.48
  - @patchsmith/core@0.1.0-beta.48

## 0.1.0-beta.47

### Patch Changes

- @patchsmith/app@0.1.0-beta.47
  - @patchsmith/core@0.1.0-beta.47
  - @patchsmith/sandbox@0.1.0-beta.47

## 0.1.0-beta.46

### Patch Changes

- Updated dependencies [20947c7]
  - @patchsmith/app@0.1.0-beta.46
  - @patchsmith/sandbox@0.1.0-beta.46
  - @patchsmith/core@0.1.0-beta.46

## 0.1.0-beta.45

### Patch Changes

- @patchsmith/app@0.1.0-beta.45
  - @patchsmith/core@0.1.0-beta.45
  - @patchsmith/sandbox@0.1.0-beta.45

## 0.1.0-beta.44

### Patch Changes

- Restore the 0.x beta release line after the accidental 1.0.0-beta.44 release. This release includes the app slug and validation changes from that release; use 0.1.0-beta.44 instead of 1.0.0-beta.44.
- 1fb0155: Use Valibot for internal validation to reduce Patchsmith bundle sizes. Accept user-provided Standard Schema validators for app functions and view instance data, preserving input/output inference and Zod primitive exports.
- Updated dependencies [89d328f]
- Updated dependencies
- Updated dependencies [1fb0155]
  - @patchsmith/core@0.1.0-beta.44
  - @patchsmith/app@0.1.0-beta.44
  - @patchsmith/sandbox@0.1.0-beta.44

## 1.0.0-beta.44

### Patch Changes

- 1fb0155: Use Valibot for internal validation to reduce Patchsmith bundle sizes. Accept user-provided Standard Schema validators for app functions and view instance data, preserving input/output inference and Zod primitive exports.
- Updated dependencies [89d328f]
- Updated dependencies [1fb0155]
  - @patchsmith/core@1.0.0-beta.44
  - @patchsmith/app@1.0.0-beta.44
  - @patchsmith/sandbox@1.0.0-beta.44

## 0.1.0-beta.43

### Patch Changes

- Updated dependencies [6a68ba5]
  - @patchsmith/core@0.1.0-beta.43
  - @patchsmith/sandbox@0.1.0-beta.43
  - @patchsmith/app@0.1.0-beta.43

## 0.1.0-beta.42

### Minor Changes

- c54e0b1: Remove Patchsmith app previews, including the `patchsmith preview` command, host preview consent and configuration, platform preview APIs and schemas, client preview metadata and stores, live revision subscriptions, and sandbox inline-source loading. Use deployed app builds for host integrations.

### Patch Changes

- Updated dependencies [c54e0b1]
  - @patchsmith/core@0.1.0-beta.42
  - @patchsmith/sandbox@0.1.0-beta.42
  - @patchsmith/app@0.1.0-beta.42

## 0.1.0-beta.41

### Patch Changes

- d4798f0: Render Pressable as an accessible div button that supports nested layout primitives, keyboard activation, focus indication, and disabled interaction styles. Keep interaction events in the host and send only the zero-argument onPress callback to the sandbox.
- @patchsmith/app@0.1.0-beta.41
  - @patchsmith/client-platform@0.1.0-beta.41
  - @patchsmith/core@0.1.0-beta.41
  - @patchsmith/sandbox@0.1.0-beta.41

## 0.1.0-beta.40

### Minor Changes

- b636758: Add a Pressable primitive with inline, box, flex, and grid layouts, token-based style props that combine breakpoint and interaction state values, and an onPress callback. The host renders a native button with keyboard activation and disabled behavior; interaction styling stays in the host.

  Replace the `base` style fallback with `default` across primitives. Style props continue to accept token strings and now support conditional objects with host-defined breakpoint names and `:hover`, `:active`, `:focus-visible`, and `:disabled` states. State values can contain breakpoint overrides. Breakpoint names `default` and all names starting with `:` are rejected by TypeScript and at runtime.

  Generate breakpoint and interaction types from serialized component fields, and preserve each property's authored breakpoint order. Breakpoint values require media-query widths; null fallback breakpoints and the generator's legacy `fieldKeys` schema fallback are no longer supported.

  Serialize repeated JSON Schema subtrees once in local `$defs` and reuse them through `$ref`, reducing schema payload size. Type generation resolves local references independently within component fields, callbacks, views, and tools, with explicit errors for unresolved, external, or circular references.

### Patch Changes

- Updated dependencies [b636758]
  - @patchsmith/core@0.1.0-beta.40
  - @patchsmith/sandbox@0.1.0-beta.40
  - @patchsmith/app@0.1.0-beta.40
  - @patchsmith/client-platform@0.1.0-beta.40

## 0.1.0-beta.39

### Patch Changes

- Updated dependencies [ad770d2]
  - @patchsmith/core@0.1.0-beta.39
  - @patchsmith/client-platform@0.1.0-beta.39
  - @patchsmith/sandbox@0.1.0-beta.39
  - @patchsmith/app@0.1.0-beta.39

## 0.1.0-beta.38

### Patch Changes

- Updated dependencies [469d8c2]
  - @patchsmith/core@0.1.0-beta.38
  - @patchsmith/sandbox@0.1.0-beta.38
  - @patchsmith/app@0.1.0-beta.38
  - @patchsmith/client-platform@0.1.0-beta.38

## 0.1.0-beta.37

### Patch Changes

- Updated dependencies [0d72562]
  - @patchsmith/core@0.1.0-beta.37
  - @patchsmith/app@0.1.0-beta.37
  - @patchsmith/sandbox@0.1.0-beta.37
  - @patchsmith/client-platform@0.1.0-beta.37

## 0.1.0-beta.36

### Patch Changes

- Updated dependencies [c0ce502]
  - @patchsmith/core@0.1.0-beta.36
  - @patchsmith/client-platform@0.1.0-beta.36
  - @patchsmith/sandbox@0.1.0-beta.36
  - @patchsmith/app@0.1.0-beta.36

## 0.1.0-beta.35

### Patch Changes

- @patchsmith/app@0.1.0-beta.35
  - @patchsmith/client-platform@0.1.0-beta.35
  - @patchsmith/core@0.1.0-beta.35
  - @patchsmith/sandbox@0.1.0-beta.35

## 0.1.0-beta.34

### Patch Changes

- Updated dependencies [82aa45f]
  - @patchsmith/core@0.1.0-beta.34
  - @patchsmith/client-platform@0.1.0-beta.34
  - @patchsmith/sandbox@0.1.0-beta.34
  - @patchsmith/app@0.1.0-beta.34

## 0.1.0-beta.33

### Patch Changes

- Updated dependencies [a215860]
  - @patchsmith/core@0.1.0-beta.33
  - @patchsmith/sandbox@0.1.0-beta.33
  - @patchsmith/app@0.1.0-beta.33
  - @patchsmith/client-platform@0.1.0-beta.33

## 0.1.0-beta.32

### Patch Changes

- Updated dependencies [1929607]
  - @patchsmith/client-platform@0.1.0-beta.32
  - @patchsmith/core@0.1.0-beta.32
  - @patchsmith/sandbox@0.1.0-beta.32
  - @patchsmith/app@0.1.0-beta.32

## 0.1.0-beta.31

### Patch Changes

- 4d2f904: Align source code with Ultracite’s default Oxlint and Oxfmt presets while preserving public APIs and runtime lifecycle behavior.
- Updated dependencies [4d2f904]
  - @patchsmith/app@0.1.0-beta.31
  - @patchsmith/client-platform@0.1.0-beta.31
  - @patchsmith/core@0.1.0-beta.31
  - @patchsmith/sandbox@0.1.0-beta.31

## 0.1.0-beta.30

### Patch Changes

- a79bf54: Omit the `children` renderer argument for components that do not support children and when no children are rendered.
- Updated dependencies [f8dce5d]
- Updated dependencies [29f3e30]
  - @patchsmith/app@0.1.0-beta.30
  - @patchsmith/sandbox@0.1.0-beta.30
  - @patchsmith/client-platform@0.1.0-beta.30
  - @patchsmith/core@0.1.0-beta.30

## 0.1.0-beta.29

### Patch Changes

- Updated dependencies [3567f94]
  - @patchsmith/core@0.1.0-beta.29
  - @patchsmith/sandbox@0.1.0-beta.29
  - @patchsmith/app@0.1.0-beta.29
  - @patchsmith/client-platform@0.1.0-beta.29

## 0.1.0-beta.28

### Patch Changes

- Updated dependencies [a0ffa4f]
  - @patchsmith/client-platform@0.1.0-beta.28
  - @patchsmith/core@0.1.0-beta.28
  - @patchsmith/sandbox@0.1.0-beta.28
  - @patchsmith/app@0.1.0-beta.28

## 0.1.0-beta.27

### Minor Changes

- 664a460: Allow `useViewContext` errors to be booleans, strings, or `Error` instances. Only `false`, `null`, and `undefined` mean no error; all strings, including an empty string, mark the view as failed. Errors continue to take precedence over loading and suppress context publication.
- 4685874: Remove the React provider's `subjectId` prop and subject-based cache partitioning and remounting. Providers share their client cache, and backend sessions are cached per app until renewal or an explicit refresh. Remove the session provider's subject cache key and the endpoint client's `setSubject` method; authenticated subject identity continues to come from the server.

  Expose `client.clearCache()` to clear shared app data and backend sessions after host authentication changes.

### Patch Changes

- Updated dependencies [21761f2]
- Updated dependencies [4685874]
  - @patchsmith/core@0.1.0-beta.27
  - @patchsmith/app@0.1.0-beta.27
  - @patchsmith/sandbox@0.1.0-beta.27
  - @patchsmith/client-platform@0.1.0-beta.27

## 0.1.0-beta.26

### Minor Changes

- 3fa95bc: Define shared browser-safe contracts with `defineContract` and `action().input().output()`. Use `createServer` from `patchsmith/server` to implement actions and `createClient` from `patchsmith/react` to infer component, view, slot, and scope types from the same contract.

  Host clients validate view context through the contract's original Standard Schema validators and publish the parsed output. Remove JSON Schema reconstruction and host `/meta` requests; resolve slots locally from the contract and accept an explicit client `assetsBaseUrl` for deployment URL fallbacks. Keep server metadata for app type generation, including scope schemas.

  Migrate existing server configuration into `defineContract`, move handlers and secrets to `createServer`, and replace the server type generic on React clients with a `contract` option.

  Contract actions without an input schema infer `undefined`; actions without an output schema infer `void`. Server implementations use the same contract return types, including `Promise<void>` for asynchronous handlers.

  Pass Valibot's `toJsonSchema` directly as the server `schemaSerializer`. Converters receive JSON Schema 2020-12 options, with `typeMode: "input"` for action inputs and `typeMode: "output"` for action results and other metadata; existing single-argument serializers remain supported.

### Patch Changes

- Updated dependencies [274ead8]
- Updated dependencies [3fa95bc]
  - @patchsmith/sandbox@0.1.0-beta.26
  - @patchsmith/core@0.1.0-beta.26
  - @patchsmith/app@0.1.0-beta.26
  - @patchsmith/client-platform@0.1.0-beta.26

## 0.1.0-beta.25

### Minor Changes

- 441a5a9: Rename `Slot` to `RenderSlot` (including client-bound `RenderSlot.Controlled`) and replace its `name` prop with `slot`. Rename the public types to `RenderSlotProps`, `ControlledRenderSlotProps`, `RuntimeRenderSlotProps`, `RenderSlotContext`, and `RenderSlotComponent`.

  Remove the standalone `Root` provider and its DOM/render props. Return a client-bound `Provider` from `createPatchsmithClient`, accepting only `children` and `apps`, with the client supplied internally. Export it as `Provider: PatchsmithProvider` alongside the hooks and `RenderSlot`, and wrap host components in `<PatchsmithProvider>`. Export `PatchsmithProviderProps` for the bound provider.

### Patch Changes

- Updated dependencies [441a5a9]
  - @patchsmith/app@0.1.0-beta.25
  - @patchsmith/sandbox@0.1.0-beta.25
  - @patchsmith/client-platform@0.1.0-beta.25
  - @patchsmith/core@0.1.0-beta.25

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
  - @patchsmith/app@0.1.0-beta.24
  - @patchsmith/sandbox@0.1.0-beta.24
  - @patchsmith/core@0.1.0-beta.24
  - @patchsmith/client-platform@0.1.0-beta.24

## 0.1.0-beta.23

### Patch Changes

- @patchsmith/app@0.1.0-beta.23
  - @patchsmith/client-platform@0.1.0-beta.23
  - @patchsmith/core@0.1.0-beta.23
  - @patchsmith/sandbox@0.1.0-beta.23

## 0.1.0-beta.22

### Minor Changes

- 382f569: Replace `useSlotInstances` and `useViews` with `useSlot({ slot })`. Single-view slots return one `{ app }` item per app with an enabled, supported view, without requiring registered context or calling instance resolvers. Multiple-view slots retain context-based instance resolution and return `{ app, key, metadata, data }` items. Support app and scope filters, infer result types from the slot's multiple flag, and rename the shared slot store and cache configuration to match. Cache timings remain internal and are not exposed as hook options.

### Patch Changes

- c29880d: Replace TanStack Store with Nanostores for client fetch caches, preview sessions, view registration, and remote UI node state. Preserve change-only subscriptions, stable snapshots, and batched preview updates. Exposed local `state` stores now use the Nanostores atom API (`get`, `set`, and `listen`).

  Migrate app query, mutation, and action state to Nanostores with its Preact adapter. Preserve shared query subscriptions, selective updates, and protection against stale call results.

- Updated dependencies [c29880d]
- Updated dependencies [268df1e]
  - @patchsmith/app@0.1.0-beta.22
  - @patchsmith/sandbox@0.1.0-beta.22
  - @patchsmith/client-platform@0.1.0-beta.22
  - @patchsmith/core@0.1.0-beta.22

## 0.1.0-beta.21

### Patch Changes

- 1c52fe8: Add minimal package READMEs with readable names and short descriptions.
- Updated dependencies [1c52fe8]
  - @patchsmith/app@0.1.0-beta.21
  - @patchsmith/client-platform@0.1.0-beta.21
  - @patchsmith/core@0.1.0-beta.21
  - @patchsmith/sandbox@0.1.0-beta.21

## 0.1.0-beta.20

### Minor Changes

- e2de939: Add the framework-independent client-core package with TanStack Store-backed state and endpoint clients. Fetch stores for apps, metadata, slot instances, and preview sessions are separate from local view registration and remote UI node state. React uses shared response caching and in-flight request deduplication with configurable stale and retention times, while preserving its public app and view types.

### Patch Changes

- Updated dependencies [a2ed82b]
- Updated dependencies [fc09d5b]
  - @patchsmith/core@0.1.0-beta.20
  - @patchsmith/app@0.1.0-beta.20
  - @patchsmith/client-platform@0.1.0-beta.20
  - @patchsmith/sandbox@0.1.0-beta.20
