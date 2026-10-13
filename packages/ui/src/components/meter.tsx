"use client";

import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import type React from "react";

import { cn } from "#ui";

export { Meter as MeterPrimitive } from "@base-ui/react/meter";

export const MeterTrack = ({
  className,
  ...props
}: MeterPrimitive.Track.Props): React.ReactElement => (
  <MeterPrimitive.Track
    className={cn("block h-2 w-full overflow-hidden bg-input", className)}
    data-slot="meter-track"
    {...props}
  />
);

export const MeterIndicator = ({
  className,
  ...props
}: MeterPrimitive.Indicator.Props): React.ReactElement => (
  <MeterPrimitive.Indicator
    className={cn("bg-primary transition-all duration-500", className)}
    data-slot="meter-indicator"
    {...props}
  />
);

export const Meter = ({
  className,
  children,
  ...props
}: MeterPrimitive.Root.Props): React.ReactElement => (
  <MeterPrimitive.Root
    className={cn("flex w-full flex-col gap-2", className)}
    {...props}
  >
    {children ?? (
      <MeterTrack>
        <MeterIndicator />
      </MeterTrack>
    )}
  </MeterPrimitive.Root>
);

export const MeterLabel = ({
  className,
  ...props
}: MeterPrimitive.Label.Props): React.ReactElement => (
  <MeterPrimitive.Label
    className={cn("text-sm font-medium text-foreground", className)}
    data-slot="meter-label"
    {...props}
  />
);

export const MeterValue = ({
  className,
  ...props
}: MeterPrimitive.Value.Props): React.ReactElement => (
  <MeterPrimitive.Value
    className={cn("text-sm text-foreground tabular-nums", className)}
    data-slot="meter-value"
    {...props}
  />
);
