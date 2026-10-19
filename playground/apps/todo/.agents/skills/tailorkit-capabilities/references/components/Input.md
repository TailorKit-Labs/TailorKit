# Input
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Import from `#tailorkit`. Does not accept children.
Exact contract: [generated bindings](../../../../../src/tailorkit.gen.ts); search for `InputProps`.

## Props

| Prop | Accepted values |
| --- | --- |
| placeholder | string |
| value | string |

## Callbacks

Callbacks cross the asynchronous host bridge. Payloads below are serialized values; use them directly.

| Callback | Payload |
| --- | --- |
| onValueChange | { value (required): string } |

Use only the listed props and callbacks. Layout and styling values come from this host, including any responsive/state objects listed above.
