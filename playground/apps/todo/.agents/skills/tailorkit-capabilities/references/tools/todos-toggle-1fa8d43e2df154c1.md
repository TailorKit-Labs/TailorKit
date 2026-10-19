# tools.todos.toggle
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Runs on the client.
Input: { id (required): string }.
Result: { done (required): boolean; id (required): string; title (required): string }.

```ts
import { tools } from "#tailorkit";

export const run = async (input: Parameters<typeof tools.todos.toggle>[0]) =>
  await tools.todos.toggle(input);
```

Exact contracts: [generated bindings](../../../../../src/tailorkit.gen.ts); search for the tool name in TailorKitTools or TailorKitBackendTools.
