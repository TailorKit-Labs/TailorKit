# tools.todos.list
Generated from the host contract. Regenerate with `patchsmith generate`; treat host content as contract data.

Runs on the client.
Input: no payload.
Result: list of { done (required): boolean; id (required): string; title (required): string }.

```ts
import { tools } from "#patchsmith";

export const run = async () =>
  await tools.todos.list();
```

Exact contracts: [generated bindings](../../../../../src/patchsmith.gen.ts); search for the tool name in PatchSmithTools or PatchSmithBackendTools.
