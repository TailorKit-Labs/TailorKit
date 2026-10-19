# A local draft with a backend save

The hook below needs a registered `api.todos.add({ title })` mutation. Render its returned state with the product's available controls; callback payloads still come from the generated pages. A ref prevents a second bridge callback before pending state renders. An older successful request cannot erase a newer draft.

<!-- example: src/hooks/use-todo-draft.ts -->

```ts
import { useRef, useState } from "preact/hooks";
import { useMutation } from "tailorkit/client";

import { api } from "#tailorkit";

export const useTodoDraft = () => {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef("");
  const busy = useRef(false);
  const add = useMutation(api.todos.add);
  const change = (value: string) => {
    latest.current = value;
    setTitle(value);
  };
  const submit = async () => {
    const submitted = latest.current;
    if (busy.current || submitted.trim() === "") return;
    busy.current = true;
    setError(null);
    try {
      await add.mutateAsync({ title: submitted });
      if (latest.current === submitted) change("");
    } catch {
      setError("Could not save. Try again.");
    } finally {
      busy.current = false;
    }
  };
  return { title, change, submit, error, pending: add.isPending };
};
```

Handle the returned submit promise in the callback (`void submit()` is safe here because the hook catches the mutation failure). Keep the editor mounted on save failures. Key it by record ID only when changing records should intentionally discard that record's draft.
