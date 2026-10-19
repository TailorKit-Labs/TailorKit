# Frontend UI and interaction

## Build with the host's components

Find components through `src/tailorkit.gen/reference/index.md`, then read `reference/components/<Name>.md` for just the controls and layout needed. Each page lists props and accepted values, callback payloads, children rules, and a link to the exact component module for uncommon nested types. Import components from `#tailorkit`. Local Preact components can compose them with fragments and providers. Use exposed layout, typography, spacing, color, and interaction props to match the host's design system.

The visible elements belong to the host renderer. App JSX runs in a hidden iframe and describes remote UI; adding HTML, CSS, Tailwind, a DOM UI kit, or direct DOM access cannot extend the host contract. Use an exposed image or icon component when available; file assets alone do not add a host component. If a control or styling option is missing, use a supported alternative or explain the necessary host addition.

## The asynchronous event bridge

When a host control emits an event, TailorKit sends its declared, serializable callback arguments to the iframe through postMessage. The generated callback invokes app code there. Preact updates are serialized back to the host renderer. This browser-local path does not require a network call, but it crosses event-loop and serialization boundaries. Backend calls and server tools add their own network latency.

A callback typed as returning void still arrives asynchronously. Its inputs are contract-defined values, not a live DOM or React SyntheticEvent. Read the generated signature: an input might supply a string, `{ value }`, checked state, selected IDs, or no argument. Do not assume `event.target`, `currentTarget`, FormData, DOM refs, or `preventDefault()` are available. The app callback cannot synchronously cancel the host's original browser event, and the host bridge does not wait for an app callback's return value. Use the host's documented form and control behavior.

Keep callback work short. Start asynchronous mutations or actions explicitly, show pending/error state, and avoid assuming that a cross-bridge callback has completed before another interaction occurs. Use the submit/commit payload as the authoritative value when the host provides one.

## Prefer uncontrolled controls where supported

For text fields and other frequently changing controls, prefer the contract's uncontrolled API, such as `defaultValue`, `defaultChecked`, or a host-managed form submission. The host can then update the visible control immediately without waiting for each edit to travel to the iframe, trigger Preact state, and return as a new controlled prop. That round trip can cause noticeable typing lag, cursor jumps, or stale values on slower clients.

- First check which props and commit callbacks the generated contract actually exposes. Do not invent uncontrolled props or form events.
- Initialize a draft from existing data once. Collect final values from the declared submit, blur, or commit callback when available. If only change callbacks exist, track the latest declared value in a ref when it does not need to drive rendering.
- Reset a host-managed control intentionally when the edited record changes or the user requests reset. A changed `defaultValue` is not a reliable reset command. Use an exposed reset operation or a deliberate stable key change for that boundary, not a new key on every render.
- Avoid resynchronizing a dirty draft from every reactive query update; background data should not erase user edits.

Controlled components are appropriate when the host contract requires them or the feature needs app-driven values, cross-field UI, or validation during editing. Update local draft state promptly, keep the affected tree small, and use functional state updates when deriving from prior state. Debounce expensive searches or persistence, rather than delaying the visible controlled value. Do not await backend calls before acknowledging an edit. If the host exposes only a controlled API, use it correctly and describe the benefit of an uncontrolled contract addition when relevant.

## Composition, state, and performance

Keep component definitions stable at module scope. Use stable record/instance keys, unconditional hooks, and complete hook dependencies. Split reusable controls by responsibility; use children or small explicit variants rather than many interacting booleans. Share state through narrowly scoped providers when distant descendants need it.

A stable app shell should retain its `<ClientProvider><Route /></ClientProvider>` when backend hooks are used. Keep providers above changing view leaves to preserve shared subscriptions. Read route context and instance data inside the relevant view tree; the views skill describes those boundaries.

Use reactive `useQuery` subscriptions for app data and `useMutation`/`useAction` for writes or external work; read the functions skill. Query hooks with the same input can share subscriptions under the provider. Avoid polling, unnecessary duplicate reads, and fetching data once per list row when a bounded backend query can return it together. Start independent async work together and sequence only dependent work. Keep serialized props and returned data small; paginate large collections and avoid rebuilding whole trees for one input. Measure before adding memoization.

## Complete interaction states

Use the host's supported labels, descriptions, accessible names, validation messages, and disabled/pending props. Check allowed children and button/form semantics rather than assuming native HTML props. Provide meaningful loading, empty, error, and success states; preserve entered data after failed submissions and prevent duplicate writes. Display errors through exposed UI components or tools, not an alert or DOM overlay.

For host-owned actions such as navigation or toasts, call the generated client tool if exposed. For host-owned records or permissions, use exposed host tools and context rather than reaching into the surrounding page. Async results should not overwrite a newer selection or draft; handle stale responses and cleanup when the view changes.

Verify behavior in the actual host when available: fast typing on a slow client, focus/cursor preservation, keyboard operation, repeated submissions, switching records, and failures. A successful type check cannot verify the host component mapping or bridge responsiveness.
