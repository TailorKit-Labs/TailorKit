"use client";

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import type React from "react";

import { cn } from "#ui";

export { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";

export const Avatar = ({
  className,
  ...props
}: AvatarPrimitive.Root.Props): React.ReactElement => (
  <AvatarPrimitive.Root
    className={cn(
      "relative isolate inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-background align-middle text-xs font-medium select-none",
      className
    )}
    data-slot="avatar"
    {...props}
  />
);

export const AvatarImage = ({
  className,
  ...props
}: AvatarPrimitive.Image.Props): React.ReactElement => (
  <AvatarPrimitive.Image
    className={cn(
      "absolute inset-0 z-10 size-full object-cover data-error:invisible data-loading:invisible",
      className
    )}
    data-slot="avatar-image"
    {...props}
  />
);

export const AvatarFallback = ({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props): React.ReactElement => (
  <AvatarPrimitive.Fallback
    className={cn(
      "absolute inset-0 flex size-full items-center justify-center rounded-full bg-muted",
      className
    )}
    data-slot="avatar-fallback"
    {...props}
  />
);
