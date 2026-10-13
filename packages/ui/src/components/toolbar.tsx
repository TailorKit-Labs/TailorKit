"use client";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import type React from "react";

import { cn } from "#ui";

export { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";

export const Toolbar = ({
  className,
  ...props
}: ToolbarPrimitive.Root.Props): React.ReactElement => (
  <ToolbarPrimitive.Root
    className={cn(
      "relative flex gap-2 rounded-xl border bg-card p-1 text-card-foreground not-dark:bg-clip-padding",
      className
    )}
    data-slot="toolbar"
    {...props}
  />
);

export const ToolbarButton = ({
  className,
  ...props
}: ToolbarPrimitive.Button.Props): React.ReactElement => (
  <ToolbarPrimitive.Button
    className={cn(className)}
    data-slot="toolbar-button"
    {...props}
  />
);

export const ToolbarLink = ({
  className,
  ...props
}: ToolbarPrimitive.Link.Props): React.ReactElement => (
  <ToolbarPrimitive.Link
    className={cn(className)}
    data-slot="toolbar-link"
    {...props}
  />
);

export const ToolbarInput = ({
  className,
  ...props
}: ToolbarPrimitive.Input.Props): React.ReactElement => (
  <ToolbarPrimitive.Input
    className={cn(className)}
    data-slot="toolbar-input"
    {...props}
  />
);

export const ToolbarGroup = ({
  className,
  ...props
}: ToolbarPrimitive.Group.Props): React.ReactElement => (
  <ToolbarPrimitive.Group
    className={cn("flex items-center gap-1", className)}
    data-slot="toolbar-group"
    {...props}
  />
);

export const ToolbarSeparator = ({
  className,
  ...props
}: ToolbarPrimitive.Separator.Props): React.ReactElement => (
  <ToolbarPrimitive.Separator
    className={cn(
      "shrink-0 bg-border data-[orientation=horizontal]:my-0.5 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:my-1.5 data-[orientation=vertical]:w-px data-[orientation=vertical]:not-[[class^='h-']]:not-[[class*='_h-']]:self-stretch",
      className
    )}
    data-slot="toolbar-separator"
    {...props}
  />
);
