# TailorKit React

Use the React components and hooks in `@tailorkit/react` to integrate TailorKit into your SaaS product.

## Pressable

Register the standard `primitives` with the host client and `primitives(theme)` with the contract's Zod, Valibot, or ArkType adapter. Generated extension types expose the same Pressable API for every validator.

Pressable owns a `<div role="button">` and its layout. `layout` defaults to `"inline"` (`inline-flex`); `"box"`, `"flex"`, and `"grid"` use `block`, `flex`, and `grid`. It accepts existing primitive theme tokens, responsive styles, and layout props, including `align`, `gap`, `padding`, and `columns`.

```tsx
<Pressable
  layout="flex"
  align="center"
  gap="sm"
  padding="md"
  onPress={openEmail}
>
  <Box grow="1">
    <Inline>{email.sender}</Inline>
    <Inline>{email.subject}</Inline>
  </Box>
  <Inline>{email.receivedAt}</Inline>
</Pressable>
```

Use non-interactive layout children. Nested interactive controls, including buttons, links, inputs, and other Pressables, are unsupported. Pressable does not promote a child or support `asChild`.

Enabled controls participate in Tab and Shift+Tab navigation and show a focus outline. Pointer clicks activate once. Enter activates on keydown; Space activates on keyup and prevents scrolling. Holding a key does not repeat activation. Blur or disabling cancels pending Space activation. Focus stays on the control unless the action intentionally moves it. This follows the [ARIA button keyboard pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/).

Children provide the accessible name. Set `ariaLabel` for an explicit name, including icon-only actions. `disabled` exposes `aria-disabled="true"`, sets `tabIndex={-1}`, and blocks pointer, keyboard, and programmatic click activation. The API also permits omitting `onPress`.

Style interactions with `:hover`, `:active`, `:focus-visible`, and `:disabled` conditional token values. `:active` includes held keyboard activation; `:disabled` targets the ARIA disabled state and suppresses other interaction styles. Each style accepts responsive breakpoint values. The default focus outline uses the host's `--ring` color, with `currentColor` as a fallback.

DOM events, keyboard state, focus, and styles stay in the React host. Only the zero-argument `onPress?: () => void` callback is dispatched into the sandbox. The host-provided Button and other primitives retain their existing behavior.
