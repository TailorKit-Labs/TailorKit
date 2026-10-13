"use client";

import { useId } from "react";
import type { ComponentProps } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../components/field";
import { Switch } from "../components/switch";
import { formatFieldErrors } from "./field-errors";

const emptyErrors: unknown[] = [];

export interface BooleanFieldProps {
  checked?: boolean;
  description?: string;
  disabled?: boolean;
  errors?: unknown[];
  label: string;
  onBlur?: ComponentProps<typeof Switch>["onBlur"];
  onCheckedChange?: ComponentProps<typeof Switch>["onCheckedChange"];
  required?: boolean;
}

export const BooleanField = ({
  checked,
  description,
  disabled,
  errors = emptyErrors,
  label,
  onBlur,
  onCheckedChange,
  required,
}: BooleanFieldProps) => {
  const id = useId();
  const errorMessage = formatFieldErrors(errors);
  const isError = errorMessage.length > 0;

  return (
    <Field className="flex-row items-start gap-2" disabled={disabled}>
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onBlur={onBlur}
        onCheckedChange={onCheckedChange}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id}>
          {label}{" "}
          {required && <span className="text-destructive-foreground">*</span>}
        </FieldLabel>
        {description && !isError && (
          <FieldDescription>{description}</FieldDescription>
        )}
        {isError && <FieldError>{errorMessage}</FieldError>}
      </div>
    </Field>
  );
};
