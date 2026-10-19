# Frontend components

Import UI components and host tools from `#tailorkit`. The generated capability pages list each control's props, callbacks, children, and styling options. Compose those controls with Preact; use their layout, spacing, color, and accessibility props.

## Forms and callbacks

Keep form drafts in `useState`. Callbacks receive the payload in the generated signature: an object such as `{ value }`, a string, or no argument. Use that value directly; callbacks are not DOM events.

Backend hooks come from `tailorkit/client`; function references come from `api` in `#tailorkit`. They require `ClientProvider` above the component. See `tailorkit-functions` for queries, mutations, and actions.

Use the hook's pending/error state, disable overlapping saves, and keep drafts on failure.

For example, keep a note draft until its mutation succeeds. These controls assume `onValueChange({ value })` and `onClick()`; use the host's declared props and accessible labels:

<!-- example: src/components/note-editor.tsx -->

```tsx
import { useState } from "preact/hooks";
import { useMutation } from "tailorkit/client";

import { api, Box, Button, Input } from "#tailorkit";

export const NoteEditor = () => {
  const [title, setTitle] = useState("");
  const save = useMutation(api.notes.add, {
    onSuccess: () => setTitle(""),
  });
  return (
    <Box>
      <Input
        value={title}
        disabled={save.isPending}
        onValueChange={({ value }) => setTitle(value)}
      />
      <Button
        disabled={save.isPending || title.trim() === ""}
        onClick={() => save.mutate({ title })}
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
