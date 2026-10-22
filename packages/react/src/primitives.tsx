import { buildPrimitiveCss } from "@patchsmith/client-core";
import type { PrimitiveProps } from "@patchsmith/client-core";
import type { PatchsmithTheme } from "@patchsmith/core/schema";
import { createContext, useContext, useId, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { Icon } from "#icons/icon";

interface PrimitiveThemeContextValue {
  viewId: string;
  theme: PatchsmithTheme;
}

export const PrimitiveThemeContext =
  createContext<PrimitiveThemeContextValue | null>(null);

const usePrimitiveNodeId = (): string => {
  const id = useId();

  return useMemo(() => `patchsmith-${id.replaceAll(":", "")}`, [id]);
};

const Primitive = ({
  children,
  display,
  element,
  props,
}: {
  children?: ReactNode;
  display: "block" | "flex" | "grid" | "inline";
  element: "div" | "span";
  props: PrimitiveProps;
}): ReactNode => {
  const context = useContext(PrimitiveThemeContext);
  const nodeId = usePrimitiveNodeId();
  const Element = element;

  const css = context
    ? buildPrimitiveCss({
        display,
        nodeId,
        props,
        theme: context.theme,
        viewId: context.viewId,
      })
    : "";

  return (
    <Element data-patchsmith-node={nodeId}>
      {css === "" ? null : (
        <style data-patchsmith-node-style={nodeId}>{css}</style>
      )}
      {children}
    </Element>
  );
};

const isStringValue = <TValue,>(value: TValue): value is TValue & string =>
  typeof value === "string";

const isPressCallback = <TValue,>(
  value: TValue
): value is TValue & (() => void) => typeof value === "function";

const Pressable = ({
  props,
  children,
}: {
  props: PrimitiveProps;
  children?: ReactNode;
}): ReactNode => {
  const context = useContext(PrimitiveThemeContext);
  const nodeId = usePrimitiveNodeId();

  const displays = {
    box: "block",
    flex: "flex",
    grid: "grid",
    inline: "inline-flex",
  } as const;

  const { ariaLabel, layout, onPress } = props;

  const display =
    layout === "box" || layout === "flex" || layout === "grid"
      ? displays[layout]
      : displays.inline;

  const disabled = props.disabled === true;
  const [pressedKey, setPressedKey] = useState<"Enter" | " " | null>(null);

  // Cancel a held key when disabled, including if re-enabled before keyup.
  if (disabled && pressedKey !== null) {
    setPressedKey(null);
  }

  const css = context
    ? buildPrimitiveCss({
        display,
        nodeId,
        pressable: true,
        props,
        theme: context.theme,
        viewId: context.viewId,
      })
    : "";

  return (
    <>
      {css === "" ? null : (
        <style data-patchsmith-node-style={nodeId}>{css}</style>
      )}
      {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Pressable owns a div to support nested block layout primitives. */}
      <div
        aria-disabled={disabled || undefined}
        aria-label={isStringValue(ariaLabel) ? ariaLabel : undefined}
        data-pressed={!disabled && pressedKey !== null ? "" : undefined}
        data-patchsmith-node={nodeId}
        onBlur={() => {
          setPressedKey(null);
        }}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            event.stopPropagation();

            return;
          }

          if (event.button === 0 && isPressCallback(onPress)) {
            onPress();
          }
        }}
        onKeyDown={(event) => {
          const { key } = event;

          if (
            event.target !== event.currentTarget ||
            (key !== "Enter" && key !== " ")
          ) {
            return;
          }

          // A div has no native keyboard activation. Prevent defaults (including
          // Space scrolling) and dispatch directly, without synthesizing a click.
          event.preventDefault();

          if (disabled || event.repeat || pressedKey !== null) {
            return;
          }

          setPressedKey(key);

          if (key === "Enter" && isPressCallback(onPress)) {
            onPress();
          }
        }}
        onKeyUp={(event) => {
          const { key } = event;

          if (
            event.target !== event.currentTarget ||
            (key !== "Enter" && key !== " ")
          ) {
            return;
          }

          event.preventDefault();
          const activate = !disabled && key === " " && pressedKey === " ";
          setPressedKey(null);

          if (activate && isPressCallback(onPress)) {
            onPress();
          }
        }}
        onPointerDown={(event) => {
          if (disabled) {
            event.preventDefault();

            return;
          }

          if (event.button === 0) {
            event.currentTarget.focus();
          }
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        {children}
      </div>
      {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
    </>
  );
};

export const primitives = {
  Box: ({
    props,
    children,
  }: {
    props: PrimitiveProps;
    children?: ReactNode;
  }) => (
    <Primitive display="block" element="div" props={props}>
      {children}
    </Primitive>
  ),
  Flex: ({
    props,
    children,
  }: {
    props: PrimitiveProps;
    children?: ReactNode;
  }) => (
    <Primitive display="flex" element="div" props={props}>
      {children}
    </Primitive>
  ),
  Grid: ({
    props,
    children,
  }: {
    props: PrimitiveProps;
    children?: ReactNode;
  }) => (
    <Primitive display="grid" element="div" props={props}>
      {children}
    </Primitive>
  ),
  Icon: Icon({ library: "lucide" }),
  Inline: ({
    props,
    children,
  }: {
    props: PrimitiveProps;
    children?: ReactNode;
  }) => (
    <Primitive display="inline" element="span" props={props}>
      {children}
    </Primitive>
  ),
  Pressable: ({
    props,
    children,
  }: {
    props: PrimitiveProps;
    children?: ReactNode;
  }) => <Pressable props={props}>{children}</Pressable>,
} as const;

export type PrimitiveStyle = CSSProperties;
