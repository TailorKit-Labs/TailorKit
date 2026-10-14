import { Loader2Icon } from "lucide-react";
import type React from "react";

import { cn } from "#ui";

export const Spinner = ({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement => (
  <Loader2Icon
    aria-label="Loading"
    className={cn("animate-spin", className)}
    {...props}
  />
);
