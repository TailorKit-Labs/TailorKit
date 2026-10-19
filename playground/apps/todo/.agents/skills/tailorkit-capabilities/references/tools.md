# Host tools
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Import tools from #tailorkit in the frontend. App actions receive only server tools through their tools capability.
Calls return promises, not reactive subscriptions. Invoke them from event handlers or effects, handle failures and pending state, and ignore stale results after context changes. Use an action's tools capability for server-side orchestration; keep privileged credentials in the surrounding product.

- [tools.todos.add](tools/todos-add-6bfe2fb3209a3c0e.md): client operation.
- [tools.todos.list](tools/todos-list-f2d7a276699d7c36.md): client operation.
- [tools.todos.remove](tools/todos-remove-971a790b36fc8cc5.md): client operation.
- [tools.todos.toggle](tools/todos-toggle-1fa8d43e2df154c1.md): client operation.
Exact contracts: [generated bindings](../../../../src/tailorkit.gen.ts); search for `TailorKitTools` and `TailorKitBackendTools`.
