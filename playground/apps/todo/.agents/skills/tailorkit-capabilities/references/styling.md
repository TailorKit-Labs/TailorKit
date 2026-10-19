# Styling
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Component pages list each prop's accepted scalar values. Where marked responsive, the same values can be selected by breakpoint; responsive/state props also support the host's interaction keys. Search the [generated bindings](../../../../src/tailorkit.gen.ts) for `Responsive`, `Conditional`, or the prop's type alias for exact types.
Breakpoint keys exposed by this host: "2xl", "lg", "md", "sm", "xl".
Interaction keys exposed by this host: ":active", ":disabled", ":focus-visible", ":hover".
Start with scalar styles. Use responsive/state objects when the design needs them. The default key is the fallback; list minimum-width breakpoints from smaller to larger. Standard primitives apply state styles after breakpoint styles, with active above focus-visible/hover and disabled ignoring other states.
For a responsive prop, use { default: value, [breakpoint]: value }. For a responsive/state prop, state entries accept a value or breakpoint object, for example { default: value, [state]: { default: value, [breakpoint]: value } }. Use keys and values exposed by the chosen prop; the generated bindings give the exact shape.
Use host layout components and declared styling props. The app's iframe does not render host DOM or CSS.
