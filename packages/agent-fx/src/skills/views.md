# Views, context, and repeated slots

For record-specific panels, persistent shells, or query-backed repeated tiles, read the [view recipes](references/views.md). Check the generated slot/path and metadata requirements before adapting a recipe.

## Match the host's surfaces

A slot is a named UI surface supplied by the host. A view supplies app UI for a supported context path in that slot. Read `.agents/skills/tailorkit-capabilities/references/views.md` for slot descriptions, supported paths, multiplicity, and context before choosing a file location. Search `src/tailorkit.gen.ts` for `ViewPropsByPath` when exact context types are needed. These paths describe host context, not browser URLs; app filenames do not create host pages.

Put views in `src/slots/<slot>/**/*.view.tsx`, default-exporting `defineView` from `tailorkit/client`. The directory determines the slot. Dots and directories separate path segments: `members.detail.view.tsx` and `members/detail.view.tsx` both mean `/members/detail`; a final `index` is omitted, so `index.view.tsx` means `/`. Explicit `slot` and `view` declarations must agree with the file location. Each slot/path pair must be unique.

Adapt the path and content to a slot the host actually supports. Import the generated bindings in view modules, even if only for their type augmentation.

The host selects the deepest available matching view and falls back through ancestor paths. With no match, the app renders nothing in that slot. Context fields include the selected path and its declared ancestors; a fallback does not gain fields from a deeper path. Read them with the view definition's `useContext()` inside that view's component tree, rather than parsing browser location or reading the host DOM.

## Shared shells and layouts

`src/root.tsx` wraps the app; `src/slots/<slot>/root.tsx` wraps a slot. Roots default-export `defineRoute({ shellComponent: Shell })` from `tailorkit/client`. A shell renders `<Route />` to continue to the selected content. Keep the backend client provider around that outlet when using app function hooks.

Within a slot, `layout.tsx` wraps its directory path, while `members.layout.tsx` wraps `/members` and descendants. Layouts can default-export a component or a route definition; they also render `<Route />`. The nesting order is app root, slot root, matching layouts, then view. Shared shells persist while the selected view changes. A view's `useContext()` and `useInstance()` belong to its descendants, not its ancestor shells.

## Repeated instances

For a slot declared `multiple: true`, supply `instances` in the view definition and enable `server: {}` in the app configuration. For a single-instance slot, omit it. Keep the definition at module scope, use a literal `view` path, and provide an inline `instances` object with `dataSchema` and an inline arrow or function expression for `resolve`.

The [repeated-tiles example](references/views.md) shows an inline resolver calling an authorized query, its data schema, and the component reading `useInstance()`.

The build extracts `resolve` into the private Cloudflare backend. It receives `{ context, identity, signal, queries }` and may await registered app queries; it has no mutations or actions. Use those supplied capabilities and backend-safe helpers. It cannot capture the view definition, hooks, browser state, or client-only tools. The inline function requirement allows the build to extract it; an imported resolver or method shorthand is not equivalent.

Return stable, non-empty keys unique within this view, host-compatible metadata, and data matching `dataSchema`. Bound the number of instances and query results. Use identity and context to restrict accessible records; never turn a caller-provided identifier into authorization. Metadata guides the host's labels or placement, while data supplies what the view renders. Regenerate bindings after backend registration changes and verify that the resulting instances appear in the intended host surface.
