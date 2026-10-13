"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import type React from "react";

import { cn } from "#ui";

export { Field as FieldPrimitive } from "@base-ui/react/field";

export const Field = ({
  className,
  ...props
}: FieldPrimitive.Root.Props): React.ReactElement => (
  <FieldPrimitive.Root
    className={cn("flex flex-col items-start gap-2", className)}
    data-slot="field"
    {...props}
  />
);

export const FieldLabel = ({
  className,
  ...props
}: FieldPrimitive.Label.Props): React.ReactElement => (
  <FieldPrimitive.Label
    className={cn(
      "text-foreground inline-flex items-center gap-2 text-base/4.5 font-medium data-disabled:opacity-64 sm:text-sm/4",
      className
    )}
    data-slot="field-label"
    {...props}
  />
);

export const FieldItem = ({
  className,
  ...props
}: FieldPrimitive.Item.Props): React.ReactElement => (
  <FieldPrimitive.Item
    className={cn("flex", className)}
    data-slot="field-item"
    {...props}
  />
);

export const FieldDescription = ({
  className,
  ...props
}: FieldPrimitive.Description.Props): React.ReactElement => (
  <FieldPrimitive.Description
    className={cn("text-muted-foreground text-xs", className)}
    data-slot="field-description"
    {...props}
  />
);

export const FieldError = ({
  className,
  ...props
}: FieldPrimitive.Error.Props): React.ReactElement => (
  <FieldPrimitive.Error
    className={cn("text-destructive-foreground text-xs", className)}
    data-slot="field-error"
    {...props}
  />
);

export const FieldControl: typeof FieldPrimitive.Control =
  FieldPrimitive.Control;

export const FieldValidity: typeof FieldPrimitive.Validity =
  FieldPrimitive.Validity;
