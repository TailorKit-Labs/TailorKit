"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import type * as React from "react";

import { cn } from "#ui";
import { buttonVariants } from "#ui/button";
import type { Button } from "#ui/button";

export const Pagination = ({
  className,
  ...props
}: React.ComponentProps<"nav">): React.ReactElement => (
  <nav
    aria-label="pagination"
    className={cn("mx-auto flex w-full justify-center", className)}
    data-slot="pagination"
    {...props}
  />
);

export const PaginationContent = ({
  className,
  ...props
}: React.ComponentProps<"ul">): React.ReactElement => (
  <ul
    className={cn("flex flex-row items-center gap-1", className)}
    data-slot="pagination-content"
    {...props}
  />
);

export const PaginationItem = ({
  ...props
}: React.ComponentProps<"li">): React.ReactElement => (
  <li data-slot="pagination-item" {...props} />
);

export type PaginationLinkProps = {
  isActive?: boolean;
  size?: React.ComponentProps<typeof Button>["size"];
} & useRender.ComponentProps<"a">;

export const PaginationLink = ({
  className,
  isActive,
  size = "icon",
  render,
  ...props
}: PaginationLinkProps): React.ReactElement => {
  const defaultProps = {
    "aria-current": isActive ? ("page" as const) : undefined,
    className: render
      ? className
      : cn(
          buttonVariants({
            size,
            variant: isActive ? "outline" : "ghost",
          }),
          className
        ),
    "data-active": isActive,
    "data-slot": "pagination-link",
  };

  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(defaultProps, props),
    render,
  });
};

export const PaginationPrevious = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>): React.ReactElement => (
  <PaginationLink
    aria-label="Go to previous page"
    className={cn("max-sm:aspect-square max-sm:p-0", className)}
    size="default"
    {...props}
  >
    <ChevronLeftIcon className="sm:-ms-1" />
    <span className="max-sm:hidden">Previous</span>
  </PaginationLink>
);

export const PaginationNext = ({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>): React.ReactElement => (
  <PaginationLink
    aria-label="Go to next page"
    className={cn("max-sm:aspect-square max-sm:p-0", className)}
    size="default"
    {...props}
  >
    <span className="max-sm:hidden">Next</span>
    <ChevronRightIcon className="sm:-me-1" />
  </PaginationLink>
);

export const PaginationEllipsis = ({
  className,
  ...props
}: React.ComponentProps<"span">): React.ReactElement => (
  <span
    aria-hidden
    className={cn("flex min-w-7 justify-center", className)}
    data-slot="pagination-ellipsis"
    {...props}
  >
    <MoreHorizontalIcon className="size-5 sm:size-4" />
    <span className="sr-only">More pages</span>
  </span>
);
