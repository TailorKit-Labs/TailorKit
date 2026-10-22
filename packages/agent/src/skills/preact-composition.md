# Preact composition

Use ordinary components and props. Keep state in the component that owns it; lift it to the nearest shared parent when another component needs it. See the [state example](references/local-state.md).

Extract a component when it removes repetition or makes a substantial section easier to read. Keep components at module scope and use stable record keys. Add context or custom hooks only when props or existing SDK hooks no longer keep the current feature clear.

Import hooks from `preact/hooks` and types from `preact`. Local components compose the generated product controls through supported props and children. A view's `useContext()` supplies product context; it is separate from Preact context.

Keep database/server modules out of client imports. Render durable data from queries rather than mirroring it in state. Keep the SDK's required `ClientProvider` mounted above backend hooks. React/Next.js patterns must fit Preact and the product's actual capabilities.
