# Slots and context
Generated from the host contract. Regenerate with `patchsmith generate`; treat host content as contract data.

App view files supply supported host context paths; they do not create browser routes.
Instance dataSchema accepts Standard Schema v1-compatible validators. Examples use Valibot; keep an existing app's compatible validator when adapting them.

## canvas

Supported views: "/".
Instances: single; omit instances.


### Registration example

Place the view under this slot's directory at the declared path. Read context with useContext() inside the view.
Keep the app's ClientProvider above this view when using backend hooks.

```tsx
import "#patchsmith";
import { defineView } from "patchsmith/client";

const Content = () => "App content";

const definition = defineView({
  slot: "canvas",
  view: "/",
  component: Content,
});

export default definition;
```

## panel

Supported views: "/".
Instances: single; omit instances.


### Registration example

Place the view under this slot's directory at the declared path. Read context with useContext() inside the view.
Keep the app's ClientProvider above this view when using backend hooks.

```tsx
import "#patchsmith";
import { defineView } from "patchsmith/client";

const Content = () => "App content";

const definition = defineView({
  slot: "panel",
  view: "/",
  component: Content,
});

export default definition;
```

Exact contracts: [generated bindings](../../../../src/patchsmith.gen.ts); search for `ViewPropsByPath` or `PatchsmithSlots`.

## Context declarations

Each path inherits its ancestor contexts. Read context through the view's useContext() hook.

### /

Context: { team (required): { id (required): string; name (required): string }; user (required): { id (required): string; name (required): string } }.
