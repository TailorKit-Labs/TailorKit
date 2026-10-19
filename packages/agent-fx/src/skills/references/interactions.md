# A simple form

Use local state for the field and the mutation hook for pending/error state. This example assumes generated `Input` supports `value`, `disabled`, and `onValueChange({ value })`; `Button` supports `disabled` and `onClick()`; `Box` accepts children. Match controls and accessible labeling to the product's actual capabilities.

The `notes.add` mutation comes from the functions example. While saving, disable the controls. Clear the field after success; a failure keeps its value.

<!-- example: src/components/note-editor.tsx -->

```tsx
import { useMutation } from "patchsmith/client";
import { useState } from "preact/hooks";

import { api, Box, Button, Input } from "#patchsmith";

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

Render lists directly from `useQuery` data. Add coordination for overlapping requests only when the requested interaction allows them and needs it.
