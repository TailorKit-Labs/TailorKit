# Host components and tools

Build within the host's contract. `#tailorkit` is the generated app-facing API, not the host's internal UI package.

## Find the available capabilities

Inspect these declarations in `src/tailorkit.gen.ts`:

| Declaration | Use |
| --- | --- |
| `TailorKitSlots`, `ViewPropsByPath` | Slot names, supported context paths, multiplicity, and context fields. |
| Component exports and their `*Props` | Available UI, accepted props, callback payloads, and whether children are allowed. |
| `TailorKitTools`, `tools` | Callable host capabilities and their inputs/results. All calls return promises. |
| `TailorKitBackendTools` | The server tools available in backend action context. |
| `api` | References to this app's registered backend functions; use with TailorKit client hooks. |

Read only the declarations needed for the feature. Names such as `Button`, `Input`, or `Box` below are examples; use them only if generated for this host.

## Compose the UI

- Import host components and `tools` from `#tailorkit`; hooks and types come from `preact/hooks` and `preact`.
- Use the exposed layout, spacing, typography, color, and responsive props to establish hierarchy and fit the host surface. Do not assume `className`, `style`, arbitrary CSS values, or a particular component exists.
- Callback arguments are contract data, not DOM events. For an `onValueChange` typed as `(payload: { value: string }) => void`, use `onValueChange={({ value }) => setValue(value)}`. Do not assume `event.target.value` or `preventDefault()`.
- Ordinary props carry serializable data. Use functions only for declared callbacks; do not invent render props or pass local components as prop values. Compose UI through supported children.
- Use supported labels, accessibility props, and disabled/pending states. Cover loading, empty, failure, and success states; keep entered values after failed saves and show success only after the operation succeeds.

## Call host capabilities

Call `await tools.members.read({ memberId })` using the generated signature. Generated transport handles client/server dispatch and authorization; do not construct host HTTP endpoints or copy session tokens. Host navigation, dialogs, and toasts also require exposed tools or components.

Call tools from UI callbacks or a lifecycle effect for initial reads, with pending/error handling and stale-result cleanup. They are imperative calls, not reactive subscriptions. For backend orchestration, use action context `tools` (server tools only), not the generated UI callers. App-owned database state uses `api` and backend hooks instead.
