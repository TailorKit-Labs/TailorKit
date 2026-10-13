"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ChevronDownIcon } from "lucide-react";
import type React from "react";

import { cn } from "#ui";

export { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";

export const Accordion = (
  props: AccordionPrimitive.Root.Props
): React.ReactElement => (
  <AccordionPrimitive.Root data-slot="accordion" {...props} />
);

export const AccordionItem = ({
  className,
  ...props
}: AccordionPrimitive.Item.Props): React.ReactElement => (
  <AccordionPrimitive.Item
    className={cn("border-b last:border-b-0", className)}
    data-slot="accordion-item"
    {...props}
  />
);

export const AccordionTrigger = ({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props): React.ReactElement => (
  <AccordionPrimitive.Header className="flex">
    <AccordionPrimitive.Trigger
      className={cn(
        "focus-visible:ring-ring flex flex-1 cursor-pointer items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-64 data-panel-open:*:data-[slot=accordion-indicator]:rotate-180",
        className
      )}
      data-slot="accordion-trigger"
      {...props}
    >
      {children}
      <ChevronDownIcon
        className="pointer-events-none size-4 shrink-0 translate-y-0.5 opacity-80 transition-transform duration-200 ease-in-out"
        data-slot="accordion-indicator"
      />
    </AccordionPrimitive.Trigger>
  </AccordionPrimitive.Header>
);

export const AccordionPanel = ({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props): React.ReactElement => (
  <AccordionPrimitive.Panel
    className="text-muted-foreground h-(--accordion-panel-height) overflow-hidden text-sm transition-[height] duration-200 ease-in-out data-ending-style:h-0 data-starting-style:h-0"
    data-slot="accordion-panel"
    {...props}
  >
    <div className={cn("pt-0 pb-4", className)}>{children}</div>
  </AccordionPrimitive.Panel>
);

export { AccordionPanel as AccordionContent };
