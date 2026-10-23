---
"@patchsmith/core": minor
"patchsmith": minor
---

Align built-in primitive scales with Tailwind CSS v4. Radius now uses `xs` through `4xl` with matching values, and `full` produces pill-shaped corners. Breakpoints use Tailwind's rem values. Spacing and fixed dimensions share numeric tokens based on a `0.25rem` unit, including `width="12"` and `height="12"` for `3rem`, plus `px` and `auto` sizing.

Export `primitiveDefaults` and `defaultBreakpoints` alongside `primitives` from the Zod, Valibot, and ArkType entry points. Spread groups such as `primitiveDefaults.radius`, `primitiveDefaults.space`, and `primitiveDefaults.size` to extend or override the built-in scales in a host theme.

This is a breaking change with no compatibility aliases. Replace built-in spacing names with numeric strings: `none` → `0`, `2xs` → `0.5`, `xs` → `1`, `sm` → `2`, `md` → `4`, `lg` → `6`, `xl` → `8`, `2xl` → `12`, and `3xl` → `18`. To preserve radius values, use `2xs` → `xs`, `xs` → `sm`, `sm` → `md`, `md` → `lg`, `lg` → `xl`, `xl` → `2xl`, `2xl` → `3xl`, and `3xl` → `4xl`. Regenerate extension bindings after updating host contracts. Custom host token groups continue to replace defaults, and enum names such as `breakWord` remain camel case.
