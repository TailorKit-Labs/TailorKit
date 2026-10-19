# Styling
Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.

Component pages list each prop's accepted scalar values. Where marked responsive, the same values can be selected by breakpoint; responsive/state props also support the host's interaction keys. Shared exact types are in ../styling.ts.
Breakpoint keys exposed by this host: "default", "2xl", "lg", "md", "sm", "xl".
Interaction keys exposed by this host: ":active", ":disabled", ":focus-visible", ":hover".
For a responsive prop, use { default: value, [breakpoint]: value }. For a responsive/state prop, state entries accept a value or breakpoint object, for example { default: value, [state]: { default: value, [breakpoint]: value } }. Use keys and values exposed by the chosen prop; its focused TypeScript module gives the exact shape.
Use host layout components and declared styling props. The app's iframe does not render host DOM or CSS.
