# Button
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Import from `#tailorkit`. Accepts children between JSX tags.
Exact contract: [generated bindings](../../../../../src/tailorkit.gen.ts); search for `ButtonProps`.

## Props

| Prop | Required | Accepted values |
| --- | --- | --- |
| disabled | no | boolean |
| size | no | "default", "sm", "lg", "icon", "icon-sm" |
| variant | no | "default", "secondary", "ghost", "outline", "destructive" |

## Callbacks

Callbacks receive the serialized payload below, not a DOM event.

| Callback | Payload |
| --- | --- |
| onClick | no payload |

Use the listed props, callbacks, and styling values.

## Usage

Supply the required props listed above. Use supported children between tags.

```tsx
import { Button } from "#tailorkit";
import type { ButtonProps } from "#tailorkit";

export const Example = (props: ButtonProps) => (
  <Button {...props}>Example content</Button>
);
```
