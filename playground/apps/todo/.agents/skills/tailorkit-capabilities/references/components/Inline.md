# Inline
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Import from `#tailorkit`. Accepts children between JSX tags.
Exact contract: [generated bindings](../../../../../src/tailorkit.gen.ts); search for `InlineProps`.

## Props

| Prop | Required | Accepted values |
| --- | --- | --- |
| background | no | "hover", "muted", "pressed", "surface"; also accepts a responsive/state object (see [styling](../styling.md)) |
| borderColor | no | "default", "focus"; also accepts a responsive/state object (see [styling](../styling.md)) |
| margin | no | "2xl", "2xs", "3xl", "lg", "md", "none", "sm", "xl", "xs"; also accepts a responsive/state object (see [styling](../styling.md)) |
| overflowWrap | no | "anywhere", "breakWord", "normal"; also accepts a responsive/state object (see [styling](../styling.md)) |
| padding | no | "2xl", "2xs", "3xl", "lg", "md", "none", "sm", "xl", "xs"; also accepts a responsive/state object (see [styling](../styling.md)) |
| radius | no | "2xl", "2xs", "3xl", "lg", "md", "none", "sm", "xl", "xs"; also accepts a responsive/state object (see [styling](../styling.md)) |
| textAlign | no | "center", "end", "justify", "left", "right", "start"; also accepts a responsive/state object (see [styling](../styling.md)) |
| textColor | no | "default", "muted"; also accepts a responsive/state object (see [styling](../styling.md)) |
| textOverflow | no | "clip", "ellipsis"; also accepts a responsive/state object (see [styling](../styling.md)) |
| textTransform | no | "capitalize", "lowercase", "none", "uppercase"; also accepts a responsive/state object (see [styling](../styling.md)) |

## Callbacks

Callbacks cross the asynchronous host bridge. Payloads below are serialized values; use them directly.

| Callback | Payload |
| --- | --- |
| — | No declared callbacks. |

Use only the listed props and callbacks. Layout and styling values come from this host, including any responsive/state objects listed above.

## Usage

Supply required values from app state or validated data. Children belong between tags only when supported.

```tsx
import { Inline } from "#tailorkit";
import type { InlineProps } from "#tailorkit";

export const Example = (props: InlineProps) => (
  <Inline {...props}>Example content</Inline>
);
```


### Responsive styling example

These tokens and keys come from this prop's schema; other props may accept different values.

```ts
import type { InlineProps } from "#tailorkit";
export const styles: Pick<InlineProps, "background"> = {
  "background": { default: "hover", "2xl": "muted", ":active": "muted" },
};
```
