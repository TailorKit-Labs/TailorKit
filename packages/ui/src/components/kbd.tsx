import type * as React from "react";

import { cn } from "#ui";

export const Kbd = ({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement => (
  <kbd
    className={cn(
      "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-[.25rem] bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3",
      className
    )}
    data-slot="kbd"
    {...props}
  />
);

export const KbdGroup = ({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement => (
  <kbd
    className={cn("inline-flex items-center gap-1", className)}
    data-slot="kbd-group"
    {...props}
  />
);
