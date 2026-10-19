# tools.todos.add
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Runs on the client.
Input: { title (required): string }.
Result: { done (required): boolean; id (required): string; title (required): string }.

```ts
import { tools } from "#tailorkit";

export const run = async (input: Parameters<typeof tools["todos"]["add"]>[0]) =>
  await tools["todos"]["add"](input);
```

Exact contracts: [generated bindings](../../../../../src/tailorkit.gen.ts); search for the tool name in TailorKitTools or TailorKitBackendTools.
