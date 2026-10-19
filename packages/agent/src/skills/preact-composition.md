# Preact composition

Compose generated host components with local Preact components, fragments, and providers. Use types from `preact` and hooks from `preact/hooks`.

- Prefer children and explicit variants over growing sets of boolean mode props. Share internals between variants; use compound components when several pieces share one interaction.
- Lift shared state to the nearest common parent or a focused provider. Expose the state and actions consumers need; keep storage details inside the provider. Separate unrelated state with different update frequencies.
- Keep temporary UI state local. Read durable state through backend queries and derive counts, filters, and flags during render instead of synchronizing copied state with effects.
- Define components at module scope to preserve identity. Key changing lists by stable record IDs.
- Use `createContext` and `preact/hooks.useContext` for local shared state. The registered view's `view.useContext()` supplies host page data; these are separate contexts.
- Preserve generated callback payload types: host callbacks need not carry browser events. Use the contract's supported children, labels, accessibility props, and pending/disabled states.
- Keep server functions and database modules in the backend. UI imports generated `api`, components, and tools from `#tailorkit`.

Adapt composition ideas to the installed Preact API. React 19 and Next.js examples require translation; the host contract determines which UI capabilities are available.

For state shared by sibling controls, use the [local provider example](references/local-state.md). It keeps view-local state separate from durable backend data.
