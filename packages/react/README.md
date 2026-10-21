# Patchsmith React

Use the React components and hooks in `@patchsmith/react` to integrate Patchsmith into your SaaS product.

## TanStack Query

The client returned by `createClient` exposes `api.apps({ signal })` and `api.views({ ...input, signal })`. Each method takes a single options object; `signal` is optional, and `apps()` also works without options. These return validated promises and throw on HTTP or response-validation errors. They make a fresh host request on every call, so TanStack Query owns caching, deduplication, retries, and invalidation. Patchsmith adds no TanStack runtime dependency or adapter.

Use TanStack Query's [object syntax](https://tanstack.com/query/latest/docs/framework/react/guides/queries) inside your existing `QueryClientProvider`:

```tsx
import { useQuery } from "@tanstack/react-query";

import { patchsmithClient } from "@/lib/patchsmith-client";

const input = { slot: "panel", activeView: null };

export const PanelApps = () => {
  const {
    data: result,
    isPending,
    error,
  } = useQuery({
    queryKey: [
      "patchsmith",
      patchsmithClient.baseUrl.toString(),
      "views",
      input,
    ],
    queryFn: ({ signal }) => patchsmithClient.api.views({ ...input, signal }),
  });

  if (isPending) return <p>Loading apps…</p>;
  if (error) return <p>{error.message}</p>;
  if (result.status !== "ready") return <p>Waiting for view context…</p>;

  return result.data.map(({ app }) => (
    <patchsmithClient.RenderSlot key={app.id} app={app} slot="panel" />
  ));
};
```

`api` requests work outside a Patchsmith provider, including in loaders and with `queryClient.fetchQuery`. Rendering `RenderSlot` still needs `patchsmithClient.Provider`. To fetch installed apps, use `queryFn: ({ signal }) => patchsmithClient.api.apps({ signal })` with an apps query key.

For single-instance slots such as `panel` and `navbar`, pass `activeView: null` to discover apps. For a `page` slot with `multiple: true`, pass the active view and its ancestor context layers explicitly, and include that entire input in the query key:

```ts
const input = {
  slot: "page",
  activeView: {
    view: "/",
    layers: [{ path: "/", context: rootContext, status: "ready" as const }],
  },
};
```

Views return `{ status: "ready", data }`, or `{ status: "idle" | "loading" }` when context is unresolved. These context states are separate from TanStack's request status. The API does not read `useViewContext` registrations; changing explicit context changes the query key and fetches again. The existing `useViews` hook remains the option for automatically following registered context.

Refresh view lists after installing or updating an app with `queryClient.invalidateQueries({ queryKey: ["patchsmith", patchsmithClient.baseUrl.toString(), "views"] })`. Existing `useApps`, `useViews`, and managed `RenderSlot` requests retain their separate nanostore cache. To refresh both caches, also call the existing hooks' `fetch()` methods.

Include the active account or workspace in keys when switching between authenticated scopes. On sign-out or account changes, cancel and remove the corresponding TanStack queries and call `patchsmithClient.clearCache()` to reset Patchsmith's cached data and sessions. `clearCache()` does not clear an external query client.

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

Style interactions with `:hover`, `:active`, `:focus-visible`, and `:disabled` conditional token values. `:active` includes held keyboard activation; `:disabled` targets the ARIA disabled state and suppresses other interaction styles. Each style accepts responsive breakpoint values. The focus indicator uses `outline: auto`, letting the browser choose its appearance. Pressable does not specify an outline width, color, or offset, and does not require a host CSS variable or focus-color token.

DOM events, keyboard state, focus, and styles stay in the React host. Only the zero-argument `onPress?: () => void` callback is dispatched into the sandbox. The host-provided Button and other primitives retain their existing behavior.
