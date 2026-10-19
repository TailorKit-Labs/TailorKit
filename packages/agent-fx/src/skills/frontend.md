# Build the UI

Read the generated component pages for the controls needed, then compose them directly with Preact. Import components and tools from `#tailorkit`. Use the product's layout, spacing, color, and accessibility props.

Keep form state in the component with `useState`. Use `useQuery` for app data and `useMutation`/`useAction` for operations; their pending and error state is usually enough. The [form example](references/interactions.md) shows this pattern. Share state through props before introducing a provider or custom hook.

Callbacks receive the generated payload, such as `{ value }`, a string, or no argument. They cross an asynchronous browser bridge and are not DOM events. Use the declared values directly; `event.target` and `preventDefault()` are unavailable.

Keep local edits responsive. Use supported disabled/pending props during saves and display failures through available components. Use an exposed uncontrolled control when it fits the form; a regular controlled input is also valid. Add debounce, cancellation, or other coordination only when the feature actually needs it.

Product tools are promise-returning calls, not subscriptions. Call them from an event handler or an effect and show the result/error. Backend orchestration uses action context `tools`. Keep the required `ClientProvider` above backend hooks; use stable record keys for lists and keep components at module scope.

Verify the requested interaction in the product when possible. Add performance work in response to a visible problem.
