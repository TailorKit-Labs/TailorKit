# Slots and context
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

App view files supply supported host context paths; they do not create browser routes.

## panel

Supported views: "/".
Instances: single; omit instances.


Exact contracts: [generated bindings](../../../../src/tailorkit.gen.ts); search for `ViewPropsByPath` or `TailorKitSlots`.

## Context declarations

Each path inherits its ancestor contexts. Read context through the view's useContext() hook.

### /

Context: { team (required): { id (required): string; name (required): string }; user (required): { id (required): string; name (required): string } }.
