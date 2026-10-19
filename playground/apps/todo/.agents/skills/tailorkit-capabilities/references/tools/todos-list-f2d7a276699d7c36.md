# tools.todos.list
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Runs on the client.
Input: no payload.
Result: list of { done (required): boolean; id (required): string; title (required): string }.

```ts
import { tools } from "#tailorkit";

export const run = async () =>
  await tools.todos.list();
```

Exact contracts: [generated bindings](../../../../../src/tailorkit.gen.ts); search for the tool name in TailorKitTools or TailorKitBackendTools.
