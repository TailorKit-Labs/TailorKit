import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "#components/button";
import type { ButtonProps } from "#components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "#components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "#components/input-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#components/tooltip";
import { cn } from "#ui";

import type { BooleanFieldProps as BaseBooleanFieldProps } from "./boolean-field";
import { BooleanField as BaseBooleanField } from "./boolean-field";
import { formatFieldErrors } from "./field-errors";
import type { NumberFieldProps as BaseNumberFieldProps } from "./number-field";
import { NumberField as BaseNumberField } from "./number-field";
import type { SelectFieldProps as BaseSelectFieldProps } from "./select-field";
import { SelectField as BaseSelectField } from "./select-field";
import type { TextFieldProps as BaseTextFieldProps } from "./text-field";
import { TextField as BaseTextField } from "./text-field";

const isNumberValue = <TValue,>(value: TValue): value is TValue & number =>
  typeof value === "number";

export { formOptions } from "@tanstack/react-form";

export { formatFieldErrors } from "./field-errors";

// export useFieldContext for use in your custom components
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

export type TextFieldProps = Omit<BaseTextFieldProps, "errors" | "value">;

export const TextField = ({ onBlur, onChange, ...props }: TextFieldProps) => {
  const field = useFieldContext<string>();

  return (
    <BaseTextField
      {...props}
      errors={field.state.meta.errors}
      onBlur={(event) => {
        field.handleBlur();
        onBlur?.(event);
      }}
      onChange={(event) => {
        field.handleChange(event.target.value);
        onChange?.(event);
      }}
      value={field.state.value}
    />
  );
};

export type NumberFieldProps = Omit<BaseNumberFieldProps, "errors" | "value">;

export const NumberField = ({
  onBlur,
  onChange,
  ...props
}: NumberFieldProps) => {
  const field = useFieldContext<number | null>();

  return (
    <BaseNumberField
      {...props}
      errors={field.state.meta.errors}
      onBlur={(event) => {
        field.handleBlur();
        onBlur?.(event);
      }}
      onChange={(
        value: number | null,
        eventDetails: Parameters<
          NonNullable<BaseNumberFieldProps["onChange"]>
        >[1]
      ) => {
        field.handleChange(value);
        onChange?.(value, eventDetails);
      }}
      value={isNumberValue(field.state.value) ? field.state.value : null}
    />
  );
};

export type SelectFieldProps = Omit<BaseSelectFieldProps, "errors" | "value">;

export const SelectField = (props: SelectFieldProps) => {
  const field = useFieldContext<string>();
  const { onValueChange, ...restProps } = props;

  return (
    <BaseSelectField
      {...restProps}
      errors={field.state.meta.errors}
      onValueChange={(value) => {
        field.setValue(value || field.state.value);
        onValueChange?.(value);
      }}
      value={field.state.value}
    />
  );
};

export interface SecretTextFieldProps {
  autoFocus?: boolean;
  description?: string;
  disabled?: boolean;
  label: string;
  labelAction?: ReactNode;
  placeholder?: string;
  required?: boolean;
}

export const SecretTextField = ({
  autoFocus,
  description,
  disabled,
  label,
  labelAction,
  placeholder,
  required,
}: SecretTextFieldProps) => {
  const field = useFieldContext<string>();
  const [showSecret, setShowSecret] = useState(false);
  const { errors } = field.state.meta;
  const errorMessage = formatFieldErrors(errors);
  const isError = errorMessage.length > 0;

  return (
    <Field disabled={disabled} invalid={isError}>
      <FieldLabel className="w-full">
        {label}{" "}
        {required && <span className="text-destructive-foreground">*</span>}
        {labelAction && <div className="ml-auto">{labelAction}</div>}
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
          aria-invalid={isError || undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          onBlur={field.handleBlur}
          onChange={(e) => field.handleChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          type={showSecret ? "text" : "password"}
          value={field.state.value}
        />
        <InputGroupAddon align="inline-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={showSecret ? "Hide secret" : "Show secret"}
                  onClick={() => setShowSecret(!showSecret)}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              {showSecret ? <EyeOffIcon /> : <EyeIcon />}
            </TooltipTrigger>
            <TooltipPopup>
              {showSecret ? "Hide secret" : "Show secret"}
            </TooltipPopup>
          </Tooltip>
        </InputGroupAddon>
      </InputGroup>
      {description && <FieldDescription>{description}</FieldDescription>}
      {isError && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
};

export type BooleanFieldProps = Omit<
  BaseBooleanFieldProps,
  "checked" | "errors" | "onBlur" | "onCheckedChange"
>;

export const BooleanField = (props: BooleanFieldProps) => {
  const field = useFieldContext<boolean>();

  return (
    <BaseBooleanField
      {...props}
      checked={Boolean(field.state.value)}
      errors={field.state.meta.errors}
      onBlur={field.handleBlur}
      onCheckedChange={field.handleChange}
    />
  );
};

interface SubmitButtonState {
  canSubmit: boolean;
  isSubmitting: boolean;
  isValidating: boolean;
}

const SubmitButton = ({
  children,
  variant,
  className,
  disabled = false,
  ...props
}: Omit<ButtonProps, "type" | "loading">) => {
  const form = useFormContext();
  return (
    <form.Subscribe<SubmitButtonState>
      selector={(state) => ({
        canSubmit: state.canSubmit,
        isSubmitting: state.isSubmitting,
        isValidating: state.isValidating,
      })}
    >
      {({ canSubmit, isSubmitting, isValidating }: SubmitButtonState) => (
        <Button
          variant={variant}
          className={cn("w-min", className)}
          type="submit"
          disabled={disabled || !canSubmit}
          loading={isSubmitting || isValidating}
          {...props}
        >
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
};

const FormError = ({ children }: { children?: ReactNode }) => {
  const errorMessage = formatFieldErrors([children]);

  if (!errorMessage) {
    return null;
  }

  return (
    <Field invalid>
      <FieldError>{errorMessage}</FieldError>
    </Field>
  );
};

export const { useAppForm, withForm } = createFormHook({
  // We'll learn more about these options later
  fieldComponents: {
    BooleanField,
    NumberField,
    SecretTextField,
    SelectField,
    TextField,
  },

  fieldContext,

  formComponents: {
    FormError,
    SubmitButton,
  },

  formContext,
});
