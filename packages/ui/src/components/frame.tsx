import type * as React from "react";

import { cn } from "#ui";

export const Frame = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn(
      "relative flex flex-col rounded-2xl bg-muted/72 p-1",
      "*:[[data-slot=frame-panel]+[data-slot=frame-panel]]:mt-1",
      className
    )}
    data-slot="frame"
    {...props}
  />
);

export const FramePanel = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn(
      "relative rounded-xl border bg-background bg-clip-padding p-5 shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
      className
    )}
    data-slot="frame-panel"
    {...props}
  />
);

export const FrameHeader = ({
  className,
  ...props
}: React.ComponentProps<"header">): React.ReactElement => (
  <header
    className={cn("flex flex-col px-5 py-4", className)}
    data-slot="frame-panel-header"
    {...props}
  />
);

export const FrameTitle = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn("text-sm font-semibold", className)}
    data-slot="frame-panel-title"
    {...props}
  />
);

export const FrameDescription = ({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement => (
  <div
    className={cn("text-sm text-muted-foreground", className)}
    data-slot="frame-panel-description"
    {...props}
  />
);

export const FrameFooter = ({
  className,
  ...props
}: React.ComponentProps<"footer">): React.ReactElement => (
  <footer
    className={cn("px-5 py-4", className)}
    data-slot="frame-panel-footer"
    {...props}
  />
);
