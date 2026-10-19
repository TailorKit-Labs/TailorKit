# Slots and context
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

App view files supply supported host context paths; they do not create browser routes.

## panel

Supported views: "/".
Instances: single; omit instances.


### Registration example

Place the view under this slot's directory, matching its declared context path. Read context with the definition's useContext() inside Content; ancestor shells do not have this view context.
Keep the app's ClientProvider above this view when using backend hooks.

```tsx
import "#tailorkit";
import { defineView } from "tailorkit/client";

const Content = () => "App content";

const definition = defineView({
  slot: "panel",
  view: "/",
  component: Content,
});

export default definition;
```

Exact contracts: [generated bindings](../../../../src/tailorkit.gen.ts); search for `ViewPropsByPath` or `TailorKitSlots`.

## Context declarations

Each path inherits its ancestor contexts. Read context through the view's useContext() hook.

### /

Context: { team (required): { id (required): string; name (required): string }; user (required): { id (required): string; name (required): string } }.
