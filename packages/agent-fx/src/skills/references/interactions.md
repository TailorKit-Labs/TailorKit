# Forms, loading states, and imperative tools

Use the generated capability pages to adapt component names, props, and callback payloads. These examples assume `Input.value`, `Input.onValueChange({ value })`, `Button.onClick()`, `Button.disabled`, and `Box` children exist. Preserve the app's `ClientProvider` for backend hooks.

## Save a draft and retain it after failure

This editor uses the private-notes functions in the functions recipe. Hooks are unconditional. Validation prevents blank submits, a ref closes the gap before pending state renders, and failed saves keep the entered text. Reset after a successful save only if the user has not typed a newer draft. Add labels through the product's supported label components or accessibility props; a placeholder alone is not a label. If the product exposes no accessible naming capability, request that addition rather than inventing a DOM label relationship across the bridge.

<!-- example: src/components/note-editor.tsx -->

```tsx
import { useRef, useState } from "preact/hooks";
import { useMutation, useQuery } from "tailorkit/client";

import { api, Box, Button, Input } from "#tailorkit";

export const NoteEditor = () => {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const latestTitle = useRef(title);
  latestTitle.current = title;
  const rows = useQuery(api.notes.list);
  const save = useMutation(api.notes.add);
  const loadMessage =
    rows.error?.code === "UNAUTHORIZED"
      ? "Sign in to load private notes."
      : "Could not load notes.";

  const submit = async () => {
    const submitted = latestTitle.current;
    if (busy.current || submitted.trim() === "") return;
    busy.current = true;
    setMessage("");
    try {
      await save.mutateAsync({ title: submitted });
      if (latestTitle.current === submitted) {
        latestTitle.current = "";
        setTitle("");
      }
      setMessage("Saved.");
    } catch {
      setMessage("Could not save. Your draft is still here.");
    } finally {
      busy.current = false;
    }
  };

  return (
    <Box>
      <Input
        value={title}
        onValueChange={({ value }) => {
          latestTitle.current = value;
          setTitle(value);
        }}
      />
      <Button
        disabled={save.isPending || title.trim() === ""}
        onClick={() => {
          void submit();
        }}
      >
        {save.isPending ? "Saving…" : "Add note"}
      </Button>
      <Box>{message}</Box>
      {rows.isLoading ? <Box>Loading…</Box> : null}
      {rows.isError ? <Box>{loadMessage}</Box> : null}
      {rows.isSuccess && rows.data?.length === 0 ? (
        <Box>No notes yet.</Box>
      ) : null}
      {rows.data?.map((note) => (
        <Box key={note.id}>{note.title}</Box>
      ))}
    </Box>
  );
};
```

Use an exposed uncontrolled input when available; this controlled version fits a product exposing only `value` and a value-change callback. For editing different records, key the editor by stable record ID so an intentional record change resets the draft. For a selected-record query with required input, mount a child containing the query only when the identifier exists; keep hooks unconditional within that child. For an inputless query, `useQuery(api.notes.list, undefined, { enabled: isOpen })` can defer subscription.

## Ignore an obsolete tool response

This hook assumes the product exposes `tools.members.read({ memberId })` returning `{ name: string }`. Generated tools are imperative snapshots. An old member's response must not overwrite a newer selection. The active flag ignores late success and failure; it does not cancel the product operation. Use the generated signature rather than adding an unsupported AbortSignal parameter.

<!-- example: src/hooks/use-member.ts -->

```ts
import { useEffect, useState } from "preact/hooks";

import { tools } from "#tailorkit";

type MemberState =
  | { status: "loading" }
  | { status: "ready"; name: string }
  | { status: "error" };

export const useMember = (memberId: string): MemberState => {
  const [result, setResult] = useState<{
    memberId: string;
    state: MemberState;
  }>({
    memberId,
    state: { status: "loading" },
  });
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const member = await tools.members.read({ memberId });
        if (active)
          setResult({
            memberId,
            state: { status: "ready", name: member.name },
          });
      } catch {
        if (active) setResult({ memberId, state: { status: "error" } });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [memberId]);
  return result.memberId === memberId ? result.state : { status: "loading" };
};
```

Keep mutation results separate from the selected record's display state. For product writes or navigation, await success before showing confirmation, preserve recoverable input on failure, and define retry behavior around whether the operation may already have completed. Client tool success is not a subscription; refresh through the supported product mechanism when needed.
