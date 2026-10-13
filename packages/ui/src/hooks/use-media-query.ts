"use client";

import { useCallback, useSyncExternalStore } from "react";

const isNumberValue = <TValue>(value: TValue): value is TValue & number =>
  typeof value === "number";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const BREAKPOINTS = {
  "2xl": 1536,
  "3xl": 1600,
  "4xl": 2000,
  lg: 1024,
  md: 800,
  sm: 640,
  xl: 1280,
} as const;

type Breakpoint = keyof typeof BREAKPOINTS;

const isBreakpoint = (value: string): value is Breakpoint =>
  Object.hasOwn(BREAKPOINTS, value);

type BreakpointQuery =
  | Breakpoint
  | `max-${Breakpoint}`
  | `${Breakpoint}:max-${Breakpoint}`;

const resolveMin = (value: Breakpoint | number): string => {
  const px = isNumberValue(value) ? value : BREAKPOINTS[value];
  return `(min-width: ${px}px)`;
};

const resolveMax = (value: Breakpoint | number): string => {
  const px = isNumberValue(value) ? value : BREAKPOINTS[value];
  return `(max-width: ${px - 1}px)`;
};

const parseQuery = (
  query: BreakpointQuery | MediaQueryInput | string
): string => {
  if (!isStringValue(query)) {
    const parts: string[] = [];
    if (query.min !== undefined) {
      parts.push(resolveMin(query.min));
    }
    if (query.max !== undefined) {
      parts.push(resolveMax(query.max));
    }
    if (query.pointer === "coarse") {
      parts.push("(pointer: coarse)");
    }
    if (query.pointer === "fine") {
      parts.push("(pointer: fine)");
    }
    if (parts.length === 0) {
      return "(min-width: 0px)";
    }
    return parts.join(" and ");
  }

  if (query.startsWith("(")) {
    return query;
  }

  const parts: string[] = [];
  for (const segment of query.split(":")) {
    if (segment.startsWith("max-")) {
      const bp = segment.slice(4);
      if (isBreakpoint(bp)) {
        parts.push(resolveMax(bp));
      }
    } else if (isBreakpoint(segment)) {
      parts.push(resolveMin(segment));
    }
  }

  return parts.length > 0 ? parts.join(" and ") : query;
};

const getServerSnapshot = (): boolean => false;

export interface MediaQueryInput {
  min?: Breakpoint | number;
  max?: Breakpoint | number;
  /** Touch-like input (finger). Use "fine" for mouse/trackpad. */
  pointer?: "coarse" | "fine";
}

export const useMediaQuery = (
  query: BreakpointQuery | MediaQueryInput | string
): boolean => {
  const mediaQuery = parseQuery(query);

  const subscribe = useCallback(
    (operation: () => void) => {
      if (typeof window === "undefined") {
        return () => {
          /* Intentionally no action is needed. */
        };
      }
      const mql = window.matchMedia(mediaQuery);
      mql.addEventListener("change", operation);
      return () => mql.removeEventListener("change", operation);
    },
    [mediaQuery]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(mediaQuery).matches;
  }, [mediaQuery]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};

export const useIsMobile = (): boolean => useMediaQuery("max-md");
