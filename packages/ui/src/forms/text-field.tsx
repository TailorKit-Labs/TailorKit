"use client";

import type { HTMLInputTypeAttribute, ReactNode } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "#components/field";
import type { InputProps } from "#components/input";
import { Input } from "#components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "#components/input-group";

import { formatFieldErrors } from "./field-errors";

const emptyErrors: unknown[] = [];

export interface TextFieldProps {
  autoComplete?: InputProps["autoComplete"];
  autoFocus?: boolean;
  description?: string;
  disabled?: boolean;
  endAdornment?: ReactNode;
  errors?: unknown[];
  label: string;
  labelAction?: ReactNode;
  onBlur?: InputProps["onBlur"];
  onChange?: InputProps["onChange"];
  placeholder?: string;
  required?: boolean;
  showDescriptionWhenError?: boolean;
  type?: HTMLInputTypeAttribute;
  value?: string;
}

export const TextField = ({
  autoComplete,
  autoFocus,
  description,
  disabled,
  endAdornment,
  errors = emptyErrors,
  label,
  labelAction,
  onBlur,
  onChange,
  placeholder,
  required,
  showDescriptionWhenError = false,
  type,
  value,
}: TextFieldProps) => {
  const errorMessage = formatFieldErrors(errors);
  const isError = errorMessage.length > 0;

  return (
    <Field disabled={disabled} invalid={isError}>
      <div className="flex w-full items-center gap-2">
        <FieldLabel>
          {label}{" "}
          {required && <span className="text-destructive-foreground">*</span>}
        </FieldLabel>
        {labelAction && <div className="ml-auto">{labelAction}</div>}
      </div>
      {endAdornment ? (
        <InputGroup>
          <InputGroupInput
            aria-invalid={isError || undefined}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            disabled={disabled}
            onBlur={onBlur}
            onChange={onChange}
            placeholder={placeholder}
            required={required}
            type={type}
            value={value ?? ""}
          />
          <InputGroupAddon align="inline-end">{endAdornment}</InputGroupAddon>
        </InputGroup>
      ) : (
        <Input
          aria-invalid={isError || undefined}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          onBlur={onBlur}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          type={type}
          value={value ?? ""}
        />
      )}
      {description && (!isError || showDescriptionWhenError) && (
        <FieldDescription>{description}</FieldDescription>
      )}
      {isError && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
};
