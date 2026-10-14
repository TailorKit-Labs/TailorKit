"use client";

import { CheckboxGroup as CheckboxGroupPrimitive } from "@base-ui/react/checkbox-group";
import type React from "react";

import { cn } from "#ui";

export { CheckboxGroup as CheckboxGroupPrimitive } from "@base-ui/react/checkbox-group";

export const CheckboxGroup = ({
  className,
  ...props
}: CheckboxGroupPrimitive.Props): React.ReactElement => (
  <CheckboxGroupPrimitive
    className={cn("flex flex-col items-start gap-3", className)}
    {...props}
  />
);
