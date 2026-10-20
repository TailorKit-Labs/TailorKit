---
"@patchsmith/react": minor
"@patchsmith/client-core": minor
"@patchsmith/app": patch
"patchsmith": minor
---

Rename `Slot` to `RenderSlot` (including client-bound `RenderSlot.Controlled`) and replace its `name` prop with `slot`. Rename the public types to `RenderSlotProps`, `ControlledRenderSlotProps`, `RuntimeRenderSlotProps`, `RenderSlotContext`, and `RenderSlotComponent`.

Remove the standalone `Root` provider and its DOM/render props. Return a client-bound `Provider` from `createPatchsmithClient`, accepting only `children` and `apps`, with the client supplied internally. Export it as `Provider: PatchsmithProvider` alongside the hooks and `RenderSlot`, and wrap host components in `<PatchsmithProvider>`. Export `PatchsmithProviderProps` for the bound provider.
