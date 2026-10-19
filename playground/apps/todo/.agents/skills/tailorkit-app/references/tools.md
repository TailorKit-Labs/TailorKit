# Host tools
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Import tools from #tailorkit in the frontend. App actions receive only server tools through their tools capability.

### tools.todos.add

Runs on the client.
Input: { title (required): string }.
Result: { done (required): boolean; id (required): string; title (required): string }.

### tools.todos.list

Runs on the client.
Input: no payload.
Result: list of { done (required): boolean; id (required): string; title (required): string }.

### tools.todos.remove

Runs on the client.
Input: { id (required): string }.
Result: { ok (required): boolean }.

### tools.todos.toggle

Runs on the client.
Input: { id (required): string }.
Result: { done (required): boolean; id (required): string; title (required): string }.

Exact contracts: [generated bindings](../../../../src/tailorkit.gen.ts); search for `TailorKitTools` and `TailorKitBackendTools`.
