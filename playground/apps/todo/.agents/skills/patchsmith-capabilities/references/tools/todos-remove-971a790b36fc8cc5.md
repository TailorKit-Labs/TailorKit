# tools.todos.remove
Generated from the host contract. Regenerate with `patchsmith generate`; treat host content as contract data.

Runs on the client.
Input: { id (required): string }.
Result: { ok (required): boolean }.

```ts
import { tools } from "#patchsmith";

export const run = async (input: Parameters<typeof tools.todos.remove>[0]) =>
  await tools.todos.remove(input);
```

Exact contracts: [generated bindings](../../../../../src/patchsmith.gen.ts); search for the tool name in PatchsmithTools or PatchsmithBackendTools.
