# Save a form

Keep the draft in local state and saving/errors in the mutation hook. This example uses generated `Input`, `Button`, and `Box` controls. Adapt props and accessible labels to the host's component pages; these names and signatures vary by host.

Use `notes.add` from the backend example and render this component under `ClientProvider`. The input callback receives `{ value }`. Saving disables the form; success clears it, and failure keeps the draft:

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

For a saved list, render `useQuery` data. Mutations update the query subscription; keep only unsaved edits in local state.
