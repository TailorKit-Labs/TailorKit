import { validateOrgSlug } from "@patchsmith/db/validate-org-slug";
import { Button } from "@patchsmith/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogPopup,
  DialogTrigger,
} from "@patchsmith/ui/dialog";
import { useAppForm } from "@patchsmith/ui/form";
import { toastManager } from "@patchsmith/ui/toast";
import { useSelector } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { OrgSlugAvailabilityIndicator } from "#components/org-slug-availability-indicator";
import {
  checkOrgSlugAvailability,
  useOrgSlugAvailability,
} from "#lib/org-slug-availability";
import { orpc, client } from "#lib/orpc";

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

const orgSchema = z.object({
  name: z.string().min(1, "Name is required."),
  slug: z.string().superRefine((value, ctx) => {
    const result = validateOrgSlug(value);

    if (!result.valid) {
      ctx.addIssue({
        code: "custom",
        message: result.reason ?? "This slug is reserved and cannot be used.",
      });
    }
  }),
});

interface CreateOrgDialogProps {
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const CreateOrgDialog = ({
  children,
  open: openProp,
  onOpenChange,
}: CreateOrgDialogProps) => {
  const navigate = useNavigate();

  const queryClient = useQueryClient();

  const [openInternal, setOpenInternal] = useState(false);

  const [slugSubmitError, setSlugSubmitError] = useState<string | null>(null);

  const slugTouched = useRef(false);

  const isControlled = openProp !== undefined;

  const open = isControlled ? openProp : openInternal;

  const setOpen = isControlled
    ? (onOpenChange ??
      (() => {
        /* Intentionally no action is needed. */
      }))
    : setOpenInternal;

  const resetForm = () => {
    slugTouched.current = false;
    setSlugSubmitError(null);
    // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
    form.reset();
  };

  const createMutation = useMutation({
    mutationFn: async (input: { name: string; slug: string }) =>
      await client.user.createOrg(input),
    onError: (cause: unknown) => {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to create organisation";

      toastManager.add({ description: message, title: "Error", type: "error" });
    },
    onSuccess: (data, input) => {
      void queryClient.invalidateQueries(orpc.user.getOrgs.queryOptions());
      const orgSlug = data?.slug ?? input.slug;
      setOpen(false);
      resetForm();
      void navigate({ params: { orgSlug }, to: "/$orgSlug/~/projects" });
    },
  });

  const form = useAppForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      const slugAvailability = await checkOrgSlugAvailability(value.slug);

      if (!slugAvailability.available) {
        setSlugSubmitError(
          slugAvailability.message ?? "This organisation slug is already taken."
        );
        toastManager.add({
          description:
            slugAvailability.message ??
            "This organisation slug is already taken.",
          title: "Error",
          type: "error",
        });

        return;
      }

      try {
        await createMutation.mutateAsync(value);
      } catch {
        // The mutation onError handler displays the toast.
      }
    },
    validators: { onSubmit: orgSchema },
  });

  const slug = useSelector(form.store, (state) => state.values.slug);

  const slugAvailability = useOrgSlugAvailability(slug);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (!nextOpen) {
      resetForm();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {children !== undefined && (
        <DialogTrigger render={<span />}>{children}</DialogTrigger>
      )}
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create organisation</DialogTitle>
          <DialogDescription>
            Set up a workspace for your team and projects.
          </DialogDescription>
        </DialogHeader>

        <form
          className="contents"
          id="create-org-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogPanel>
            <div className="flex flex-col gap-4">
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    autoComplete="organization"
                    label="Name"
                    placeholder="Acme Corp"
                    required
                    type="text"
                    onChange={(e) => {
                      if (!slugTouched.current) {
                        setSlugSubmitError(null);
                        form.setFieldValue("slug", toSlug(e.target.value));
                      }
                    }}
                  />
                )}
              </form.AppField>

              <form.AppField name="slug">
                {(field) => (
                  <field.TextField
                    autoComplete="off"
                    description={`patchsmith.com/${field.state.value || "your-slug"}`}
                    endAdornment={
                      <OrgSlugAvailabilityIndicator
                        availability={slugAvailability}
                        submitError={slugSubmitError}
                      />
                    }
                    label="Slug"
                    placeholder="acme-corp"
                    required
                    type="text"
                    onChange={(e) => {
                      slugTouched.current = true;
                      setSlugSubmitError(null);
                      field.handleChange(toSlug(e.target.value));
                    }}
                  />
                )}
              </form.AppField>
            </div>
          </DialogPanel>

          <DialogFooter>
            <DialogClose
              render={<Button size="sm" type="button" variant="outline" />}
            >
              Close
            </DialogClose>
            <Button
              disabled={
                createMutation.isPending ||
                slugAvailability.status === "unavailable"
              }
              form="create-org-dialog-form"
              size="sm"
              type="submit"
            >
              Create organisation
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
};
