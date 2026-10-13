"use client";

import type { ReactNode } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "#components/field";
import type { NumberFieldProps as PrimitiveNumberFieldProps } from "#components/number-field";
import {
  NumberField as PrimitiveNumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "#components/number-field";

import { formatFieldErrors } from "./field-errors";

const emptyErrors: unknown[] = [];

export interface NumberFieldProps {
  description?: string;
  disabled?: boolean;
  errors?: unknown[];
  label: string;
  labelAction?: ReactNode;
  onBlur?: React.ComponentProps<"input">["onBlur"];
  onChange?: NonNullable<PrimitiveNumberFieldProps["onValueChange"]>;
  placeholder?: string;
  required?: boolean;
  value?: number | null;
}

export const NumberField = ({
  description,
  disabled,
  errors = emptyErrors,
  label,
  labelAction,
  onBlur,
  onChange,
  placeholder,
  required,
  value,
}: NumberFieldProps) => {
  const errorMessage = formatFieldErrors(errors);
  const isError = errorMessage.length > 0;

  return (
    <Field disabled={disabled}>
      <div className="flex w-full items-center gap-2">
        <FieldLabel>
          {label}{" "}
          {required === true && (
            <span className="text-destructive-foreground">*</span>
          )}
        </FieldLabel>
        {Boolean(labelAction) && <div className="ml-auto">{labelAction}</div>}
      </div>
      <PrimitiveNumberField
        disabled={disabled}
        onValueChange={(nextValue, eventDetails) => {
          onChange?.(nextValue, eventDetails);
        }}
        required={required}
        value={value ?? null}
      >
        <NumberFieldGroup>
          <NumberFieldDecrement />
          <NumberFieldInput onBlur={onBlur} placeholder={placeholder} />
          <NumberFieldIncrement />
        </NumberFieldGroup>
      </PrimitiveNumberField>
      {description !== undefined &&
        description !== null &&
        description !== "" && (
          <FieldDescription>{description}</FieldDescription>
        )}
      {isError && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
};
