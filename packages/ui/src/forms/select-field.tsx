"use client";

import { useState } from "react";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../components/field";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/tooltip";
import { formatFieldErrors } from "./field-errors";

const isStringValue = <TValue,>(value: TValue): value is TValue & string =>
  typeof value === "string";

const emptyErrors: unknown[] = [];

const hasBaseUIHandlerControl = <TEvent extends object>(
  event: TEvent
): event is TEvent & { preventBaseUIHandler: () => void } =>
  "preventBaseUIHandler" in event &&
  typeof event.preventBaseUIHandler === "function";

export interface SelectFieldProps {
  allowDeselect?: boolean;
  description?: string;
  disabled?: boolean;
  emptyPlaceholder?: string;
  emptyTooltip?: string;
  errors?: unknown[];
  items: { value: string; label: string }[];
  label: string;
  onValueChange?: (value: string | null) => void;
  placeholder?: string;
  required?: boolean;
  value?: string;
}

export const SelectField = ({
  allowDeselect = false,
  description,
  disabled,
  emptyPlaceholder = "No options available",
  emptyTooltip = "This field is disabled because there are no options to choose from.",
  errors = emptyErrors,
  items,
  label,
  onValueChange,
  placeholder,
  required,
  value,
}: SelectFieldProps) => {
  const errorMessage = formatFieldErrors(errors);
  const isError = errorMessage.length > 0;
  const isEmpty = items.length === 0;
  const isDisabled = disabled || isEmpty;
  const [open, setOpen] = useState(false);

  return (
    <Field disabled={isDisabled}>
      <FieldLabel>
        {label}{" "}
        {required && <span className="text-destructive-foreground">*</span>}
      </FieldLabel>
      <Select
        disabled={isDisabled}
        items={items}
        onOpenChange={setOpen}
        onValueChange={(nextValue) => {
          onValueChange?.(isStringValue(nextValue) ? nextValue : null);
        }}
        open={open}
        required={required}
        value={value}
      >
        <Tooltip>
          <TooltipTrigger render={<SelectTrigger />} disabled={!isEmpty}>
            <SelectValue
              placeholder={isEmpty ? emptyPlaceholder : placeholder}
            />
          </TooltipTrigger>
          <TooltipPopup>{emptyTooltip}</TooltipPopup>
        </Tooltip>
        <SelectPopup>
          {items.map(({ label: itemLabel, value: itemValue }) => (
            <SelectItem
              key={itemValue}
              value={itemValue}
              onClick={(event) => {
                if (!allowDeselect || itemValue !== value) {
                  return;
                }

                event.preventDefault();
                if (hasBaseUIHandlerControl(event)) {
                  event.preventBaseUIHandler();
                }
                onValueChange?.(null);
                setOpen(false);
              }}
            >
              {itemLabel}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      {isError && <FieldError>{errorMessage}</FieldError>}
    </Field>
  );
};
