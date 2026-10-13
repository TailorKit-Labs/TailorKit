"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type React from "react";

import { cn } from "#ui";

export { Progress as ProgressPrimitive } from "@base-ui/react/progress";

export const ProgressTrack = ({
  className,
  ...props
}: ProgressPrimitive.Track.Props): React.ReactElement => (
  <ProgressPrimitive.Track
    className={cn(
      "block h-1.5 w-full overflow-hidden rounded-full bg-input",
      className
    )}
    data-slot="progress-track"
    {...props}
  />
);

export const ProgressIndicator = ({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props): React.ReactElement => (
  <ProgressPrimitive.Indicator
    className={cn("bg-primary transition-all duration-500", className)}
    data-slot="progress-indicator"
    {...props}
  />
);

export const Progress = ({
  className,
  children,
  ...props
}: ProgressPrimitive.Root.Props): React.ReactElement => (
  <ProgressPrimitive.Root
    className={cn("flex w-full flex-col gap-2", className)}
    data-slot="progress"
    {...props}
  >
    {children || (
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
    )}
  </ProgressPrimitive.Root>
);

export const ProgressLabel = ({
  className,
  ...props
}: ProgressPrimitive.Label.Props): React.ReactElement => (
  <ProgressPrimitive.Label
    className={cn("text-sm font-medium", className)}
    data-slot="progress-label"
    {...props}
  />
);

export const ProgressValue = ({
  className,
  ...props
}: ProgressPrimitive.Value.Props): React.ReactElement => (
  <ProgressPrimitive.Value
    className={cn("text-sm tabular-nums", className)}
    data-slot="progress-value"
    {...props}
  />
);
