# tools.todos.add
Generated from the host contract. Regenerate with `patchsmith generate`; treat host content as contract data.

Runs on the client.
Input: { title (required): string }.
Result: { done (required): boolean; id (required): string; title (required): string }.

```ts
import { tools } from "#patchsmith";

export const run = async (input: Parameters<typeof tools.todos.add>[0]) =>
  await tools.todos.add(input);
```

Exact contracts: [generated bindings](../../../../../src/patchsmith.gen.ts); search for the tool name in PatchSmithTools or PatchSmithBackendTools.
