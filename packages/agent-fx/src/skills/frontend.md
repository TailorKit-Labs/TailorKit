# Build controls and forms

Import UI components and host tools from `#tailorkit`. The generated capability pages list each control's props, callbacks, children, and styling options. Compose those controls with Preact; use their layout, spacing, color, and accessibility props.

## Inputs and callbacks

Keep form drafts in `useState`. Callbacks receive the payload in the generated signature: an object such as `{ value }`, a string, or no argument. Use that value directly; callbacks are not DOM events.

For saved app data, use `useQuery` to read, `useMutation` to save, and `useAction` to call external services. Import these hooks from `tailorkit/client` and function references from `api` in `#tailorkit`. Keep `ClientProvider` in the app root above these hooks.

Use hook pending/error state directly. Disable controls while saving when overlapping edits are unwanted, keep drafts on failure, and use stable record keys for lists. Share state through props before adding a provider or custom hook. Define components at module scope and call hooks unconditionally.

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

## Host operations

Host tools perform exposed product operations, such as updating a contact or navigating. Call `tools` from `#tailorkit` in an event handler or effect and handle the promise's result/error. Tools return one result per call; they do not subscribe to changes. Backend actions receive server tools through their handler's `tools` value.
