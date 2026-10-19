# Input
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Import from `#tailorkit`. Does not accept children.
Exact contract: [generated bindings](../../../../../src/tailorkit.gen.ts); search for `InputProps`.

## Props

| Prop | Required | Accepted values |
| --- | --- | --- |
| placeholder | no | string |
| value | yes | string |

## Callbacks

Callbacks cross the asynchronous host bridge. Payloads below are serialized values; use them directly.

| Callback | Payload |
| --- | --- |
| onValueChange | { value (required): string } |

Use only the listed props and callbacks. Layout and styling values come from this host, including any responsive/state objects listed above.

## Usage

Supply required values from app state or validated data. Children belong between tags only when supported.

```tsx
import { Input } from "#tailorkit";
import type { InputProps } from "#tailorkit";

export const Example = (props: InputProps & Required<Pick<InputProps, "value">>) => (
  <Input {...props} />
);
```

### Local value and callback

Call this hook unconditionally at the top of a component and spread its returned props into the control. The callback receives a serialized value, not a DOM event. Changing initialValue alone does not reset a dirty draft; key the editor by record ID when a record change should reset it.

```ts
import { useState } from "preact/hooks";
import type { InputProps } from "#tailorkit";
export const useValue = (initialValue: string): Pick<InputProps, "value" | "onValueChange"> => {
  const [value, setValue] = useState(initialValue);
  return { value, "onValueChange": ({ value }) => setValue(value) };
};
```
