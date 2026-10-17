# Host-rendered Preact UI

The app runs in a hidden sandbox iframe; the host renders visible UI. Compose generated components from `#tailorkit` with Preact components, fragments, and providers. Use their typed props, callbacks, children, and styling tokens. HTML elements, CSS, DOM UI libraries, portals, browser storage, and parent-frame access cannot implement host UI.

Read the generated component and tool signatures needed for the task. Use generated `tools` for host-owned data and actions; app storage belongs in backend SQLite. If a capability is absent, explain the specific host contract addition needed and continue supported work. Keep secrets out of client code.

Views live in `src/slots/<slot>/**/*.view.tsx`, default-exporting `defineView({ view: "/supported/path", component: View })` from `tailorkit/client`. Import `#tailorkit` for type augmentation. The directory supplies the slot; filenames supply context paths (`members/detail.view.tsx` maps to `/members/detail`, `index.view.tsx` to `/`). Match the generated host's supported slots and contexts. These paths describe host context, not browser routes.

Read context through the view definition's `useContext()` inside its component tree. App/slot roots and layouts wrap descendants through `<Route />`; preserve a stable `<ClientProvider>` when backend hooks are used. Roots default-export `defineRoute({ shellComponent: Shell })` from `tailorkit/client`.

For a repeated slot (`multiple: true`), enable `server: {}` in tailorkit.config.ts and provide inline `instances: { dataSchema, resolve: (...) => ... }` in defineView. The resolver runs on the backend, receives context/identity/queries, and returns unique stable keys with host-compatible metadata and schema-valid data. It cannot capture browser state. Read the selected data with the view's `useInstance()`.

Keep hooks unconditional, callbacks typed, and list keys stable. Share state through composition and providers. Use reactive subscriptions instead of polling, avoid duplicate subscriptions and async waterfalls, and measure before adding memoization.
