import { Button } from "@tailorkit/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@tailorkit/ui/dialog";
import { Input } from "@tailorkit/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@tailorkit/ui/select";
import { toastManager } from "@tailorkit/ui/toast";
import { useMutation } from "@tanstack/react-query";
import { PlusIcon, TrashIcon, UserPlusIcon } from "lucide-react";
import { useState } from "react";

import { client } from "#lib/orpc";

interface InviteRow {
  email: string;
  role: "member" | "admin";
}

const invitableRoles = ["member", "admin"] as const;

export const InviteMembersDialog = ({
  orgSlug,
  onSuccess,
}: {
  orgSlug: string;
  onSuccess: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<InviteRow[]>([
    { email: "", role: "member" },
  ]);
  const [errors, setErrors] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: async (rows: InviteRow[]) => {
      const results = await Promise.allSettled(
        rows.map(
          async (row) =>
            await client.org.inviteMember({
              email: row.email.trim(),
              orgSlug,
              role: row.role,
            })
        )
      );
      const failed = results
        .map((result, index) =>
          result.status === "rejected"
            ? `${rows[index].email}: ${
                result.reason instanceof Error
                  ? result.reason.message
                  : "Failed"
              }`
            : null
        )
        .filter((message) => message !== null);
      if (failed.length > 0) {
        throw new Error(failed.join("\n"));
      }
    },
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error ? cause.message : "Some invitations failed";
      setErrors(message.split("\n"));
    },
    onSuccess: () => {
      setOpen(false);
      setInvites([{ email: "", role: "member" }]);
      setErrors([]);
      toastManager.add({ title: "Invitations sent", type: "success" });
      onSuccess();
    },
  });

  const updateRow = (index: number, field: keyof InviteRow, value: string) => {
    setInvites((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const valid = invites.filter((row) => row.email.trim());
    if (valid.length === 0) {
      return;
    }
    setErrors([]);
    mutation.mutate(valid);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setInvites([{ email: "", role: "member" }]);
      setErrors([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>
        <UserPlusIcon />
        Invite
      </DialogTrigger>
      <DialogPopup>
        <form onSubmit={handleSubmit} className="contents">
          <DialogHeader>
            <DialogTitle>Invite members</DialogTitle>
            <DialogDescription>
              Send email invitations to add people to this organisation.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            <div className="space-y-3">
              <div className="space-y-2">
                {invites.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={`Email address ${index + 1}`}
                      className="flex-1"
                      placeholder="colleague@example.com"
                      type="email"
                      value={row.email}
                      onChange={(event) => {
                        updateRow(index, "email", event.target.value);
                      }}
                    />
                    <Select
                      value={row.role}
                      onValueChange={(value) => {
                        if (value === "member" || value === "admin") {
                          updateRow(index, "role", value);
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label={`Role for invite ${index + 1}`}
                        className="w-32"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {invitableRoles.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role.charAt(0).toUpperCase() + role.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    {invites.length > 1 && (
                      <Button
                        aria-label="Remove invite"
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setInvites((prev) =>
                            prev.filter((_, i) => i !== index)
                          );
                        }}
                      >
                        <TrashIcon />
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <Button
                size="sm"
                type="button"
                variant="ghost"
                onClick={() => {
                  setInvites((prev) => [
                    ...prev,
                    { email: "", role: "member" },
                  ]);
                }}
              >
                <PlusIcon />
                Add another
              </Button>

              {errors.length > 0 && (
                <div className="space-y-0.5">
                  {errors.map((error, index) => (
                    <p key={index} className="text-xs text-destructive">
                      {error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button
              disabled={
                invites.every((row) => !row.email.trim()) || mutation.isPending
              }
              type="submit"
            >
              {mutation.isPending ? "Sending…" : "Send invitations"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
};
