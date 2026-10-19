# Frontend components

App frontend code runs in a hidden, sandboxed iframe. TailorKit serializes the component tree and props, then renders the visible UI using the host's components.

Import UI components and host tools from `#tailorkit`. The generated capability pages list each control's props, callbacks, children, and styling options. Compose those controls with Preact; use their layout, spacing, color, and accessibility props.

## Forms and callbacks

Host callbacks send serialized payloads back to the app's Preact code in the iframe; UI updates travel back to the host. This messaging is asynchronous and adds latency, even with synchronous handlers. Callback return values aren't sent back to the host.

Prefer uncontrolled inputs when the host supports them, so typing doesn't wait for sandbox updates. Store values needed only on submit in `useRef`; use state when a value affects rendered UI. Controlled inputs remain useful when required by the host or feature.

Callbacks receive the payload in the generated signature: an object such as `{ value }`, a string, or no argument. Use that value directly; callbacks are not DOM events.

Backend hooks come from `tailorkit/client`; function references come from `api` in `#tailorkit`. They require `ClientProvider` above the component. See `tailorkit-functions` for queries, mutations, and actions.

Use the hook's pending/error state, disable overlapping saves, and keep drafts on failure.

This uncontrolled input keeps its draft on failure and remounts empty after a successful save. It assumes the host supports omitting `value`, `onValueChange({ value })`, and `onClick()`; use the host's declared props and accessible labels:

<!-- example: src/components/note-editor.tsx -->

```tsx
import { useRef, useState } from "preact/hooks";
import { useMutation } from "tailorkit/client";

import { api, Box, Button, Input } from "#tailorkit";

export const NoteEditor = () => {
  const title = useRef("");
  const [resetKey, setResetKey] = useState(0);
  const save = useMutation(api.notes.add, {
    onSuccess: () => {
      title.current = "";
      setResetKey((key) => key + 1);
    },
  });
  return (
    <Box>
      <Input
        key={resetKey}
        disabled={save.isPending}
        onValueChange={({ value }) => {
          title.current = value;
        }}
      />
      <Button
        disabled={save.isPending}
        onClick={() => {
          if (title.current.trim()) {
            save.mutate({ title: title.current });
          }
        }}
      >
        {save.isPending ? "Saving…" : "Add note"}
      </Button>
      {save.isError ? <Box>Could not save. Try again.</Box> : null}
    </Box>
  );
};
```

## Host tools

Host tools perform exposed product operations, such as updating a contact or navigating. Call `tools` from `#tailorkit` in an event handler or effect and handle the promise's result/error. Tools return one result per call; they do not subscribe to changes.
