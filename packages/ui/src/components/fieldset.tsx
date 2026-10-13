"use client";

import { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";
import type React from "react";

import { cn } from "#ui";

export { Fieldset as FieldsetPrimitive } from "@base-ui/react/fieldset";

export const Fieldset = ({
  className,
  ...props
}: FieldsetPrimitive.Root.Props): React.ReactElement => (
  <FieldsetPrimitive.Root
    className={className}
    data-slot="fieldset"
    {...props}
  />
);

export const FieldsetLegend = ({
  className,
  ...props
}: FieldsetPrimitive.Legend.Props): React.ReactElement => (
  <FieldsetPrimitive.Legend
    className={cn("text-foreground font-semibold", className)}
    data-slot="fieldset-legend"
    {...props}
  />
);
