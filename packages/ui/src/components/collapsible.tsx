"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import type React from "react";

import { cn } from "#ui";

export { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

export const Collapsible = ({
  ...props
}: CollapsiblePrimitive.Root.Props): React.ReactElement => (
  <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
);

export const CollapsibleTrigger = ({
  className,
  ...props
}: CollapsiblePrimitive.Trigger.Props): React.ReactElement => (
  <CollapsiblePrimitive.Trigger
    className={className}
    data-slot="collapsible-trigger"
    {...props}
  />
);

export const CollapsiblePanel = ({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props): React.ReactElement => (
  <CollapsiblePrimitive.Panel
    className={cn(
      "h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 data-ending-style:h-0 data-starting-style:h-0",
      className
    )}
    data-slot="collapsible-panel"
    {...props}
  />
);

export { CollapsiblePanel as CollapsibleContent };
