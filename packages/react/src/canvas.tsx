import { experimental_canvas } from "@tailorkit/core/schema";
import type { experimental_CanvasProps } from "@tailorkit/core/schema";
import { useContext, useLayoutEffect, useMemo, useRef } from "react";

import { CanvasNodeContext } from "./canvas-context";

const ExperimentalCanvas = (props: experimental_CanvasProps) => {
  const context = useContext(CanvasNodeContext);
  const policy = context?.policy;
  const fields = useMemo(() => experimental_canvas(policy).fields, [policy]);
  const parsed = useMemo(() => {
    const result = fields["~standard"].validate(props);
    if (result instanceof Promise) {
      throw new TypeError("Canvas fields require a synchronous validator.");
    }
    return result;
  }, [fields, props]);
  const value = parsed.issues ? null : parsed.value;
  const surface = value?.surface;
  const width = value?.width;
  const height = value?.height;
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    let revoke: (() => void) | undefined;
    const element = canvas.current;
    if (
      element &&
      context?.policy &&
      surface !== undefined &&
      element.width === width &&
      element.height === height
    ) {
      revoke = context.store.experimental_registerCanvas(
        context.nodeId,
        surface,
        element,
        context.policy
      );
    }
    return revoke;
  }, [canvas, context, surface, width, height]);
  if (!policy) {
    throw new Error("Canvas rendering must be enabled in the host contract.");
  }
  if (!value) {
    throw new Error(
      parsed.issues?.map(({ message }) => message).join("; ") ??
        "Invalid canvas props."
    );
  }
  /* oxlint-disable jsx-a11y/prefer-tag-over-role -- The host canvas presents pixels and exposes its required accessible image name. */
  return (
    <canvas
      aria-label={value.ariaLabel}
      height={value.height}
      ref={canvas}
      role="img"
      style={{ height: "auto", maxWidth: "100%" }}
      width={value.width}
    />
  );
  /* oxlint-enable jsx-a11y/prefer-tag-over-role */
};

/** Host renderer for components declared with experimental_canvas(). */
export const experimental_canvasRenderer = ({
  props,
}: {
  props: experimental_CanvasProps;
}) => <ExperimentalCanvas {...props} />;
