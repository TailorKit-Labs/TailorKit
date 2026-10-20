# experimental_DoomCanvas
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Import from `#tailorkit`. Does not accept children.
Exact contract: [generated bindings](../../../../../src/tailorkit.gen.ts); search for `experimental_DoomCanvasProps`.

## Props

| Prop | Required | Accepted values |
| --- | --- | --- |
| ariaLabel | yes | string |
| height | yes | integer (minimum: 1; maximum: 4096) |
| surface | yes | string |
| width | yes | integer (minimum: 1; maximum: 4096) |

## Callbacks

Callbacks receive the serialized payload below, not a DOM event.

| Callback | Payload |
| --- | --- |
| — | No declared callbacks. |

Use the listed props, callbacks, and styling values.

## Usage

Supply the required props listed above. Use supported children between tags.

```tsx
import { experimental_DoomCanvas as Component } from "#tailorkit";
import type { experimental_DoomCanvasProps } from "#tailorkit";

export const Example = (props: experimental_DoomCanvasProps) => (
  <Component {...props} />
);
```
