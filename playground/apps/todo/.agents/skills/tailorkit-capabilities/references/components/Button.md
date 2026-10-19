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

Callbacks cross the asynchronous host bridge. Payloads below are serialized values; use them directly.

| Callback | Payload |
| --- | --- |
| onClick | no payload |

Use only the listed props and callbacks. Layout and styling values come from this host, including any responsive/state objects listed above.

## Usage

Supply required values from app state or validated data. Children belong between tags only when supported.

```tsx
import { Button } from "#tailorkit";
import type { ButtonProps } from "#tailorkit";

export const Example = (props: ButtonProps) => (
  <Button {...props}>Example content</Button>
);
```
