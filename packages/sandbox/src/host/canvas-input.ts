import type { experimental_CanvasInputEvent } from "@tailorkit/app/client";
import type { experimental_CanvasInputPolicy } from "@tailorkit/core/schema";

/** One acknowledged batch in flight, at most 32 queued transitions, and one latest move. */
export const createCanvasInput = (
  canvas: HTMLCanvasElement,
  port: MessagePort,
  policy: experimental_CanvasInputPolicy,
  onInvalidAck: () => void
) => {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let queue: experimental_CanvasInputEvent[] = [];
  let move: experimental_CanvasInputEvent | null = null;
  let frame: number | null = null;
  let sequence = 0;
  let awaiting = false;
  const keys = new Set(policy.keyboard);
  const heldKeys = new Set<string>();
  const previousTabIndex = canvas.getAttribute("tabindex");
  if (keys.size > 0) {
    canvas.tabIndex = 0;
  }
  const flush = () => {
    frame = null;
    if (awaiting || signal.aborted || (queue.length === 0 && move === null)) {
      return;
    }
    if (move !== null && queue.length < 32) {
      queue.push(move);
    }
    move = null;
    sequence += 1;
    awaiting = true;
    port.postMessage({ events: queue, sequence, type: "input" });
    queue = [];
  };
  const schedule = () => {
    if (frame === null && !awaiting && !signal.aborted) {
      frame = requestAnimationFrame(flush);
    }
  };
  const enqueue = (event: experimental_CanvasInputEvent) => {
    if (event.type === "pointer" && event.event === "pointermove") {
      move = event;
    } else if (queue.length >= 31) {
      // Losing discrete input must release held state rather than leave keys stuck.
      queue = [{ type: "blur" }];
      heldKeys.clear();
      move = null;
    } else {
      if (move !== null) {
        queue.push(move);
        move = null;
      }
      queue.push(event);
    }
    schedule();
  };
  const reset = () => {
    heldKeys.clear();
    queue = [{ type: "blur" }];
    move = null;
    schedule();
  };
  const pointer = (event: PointerEvent | MouseEvent) => {
    if (event.type === "pointerdown" && keys.size > 0) {
      canvas.focus({ preventScroll: true });
    }
    if (policy.pointer !== true) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const pointerType = "pointerType" in event ? event.pointerType : "mouse";
    const name = event.type;
    if (
      name !== "pointermove" &&
      name !== "pointerdown" &&
      name !== "pointerup" &&
      name !== "pointerleave" &&
      name !== "click"
    ) {
      return;
    }
    enqueue({
      button: event.button,
      buttons: event.buttons,
      event: name,
      pointerId: "pointerId" in event ? event.pointerId : 0,
      pointerType:
        pointerType === "touch" || pointerType === "pen"
          ? pointerType
          : "mouse",
      shiftKey: event.shiftKey,
      type: "pointer",
      x: Math.max(
        0,
        Math.min(
          canvas.width,
          ((event.clientX - rect.left) * canvas.width) / rect.width
        )
      ),
      y: Math.max(
        0,
        Math.min(
          canvas.height,
          ((event.clientY - rect.top) * canvas.height) / rect.height
        )
      ),
    });
  };
  const keyboard = (event: KeyboardEvent) => {
    if (
      canvas.ownerDocument.activeElement !== canvas ||
      !keys.has(event.code)
    ) {
      return;
    }
    const shortcut = event.ctrlKey || event.metaKey || event.altKey;
    const release = event.type === "keyup" && heldKeys.has(event.code);
    if ((shortcut && !release) || (event.type === "keyup" && !release)) {
      return;
    }
    if (event.type === "keydown") {
      heldKeys.add(event.code);
    } else {
      heldKeys.delete(event.code);
    }
    // Release captured keys even if a modifier was pressed later; never suppress shortcuts.
    if (!shortcut) {
      event.preventDefault();
    }
    enqueue({
      code: event.code,
      event: event.type === "keydown" ? "keydown" : "keyup",
      key: event.key.slice(0, 64),
      repeat: event.repeat,
      shiftKey: event.shiftKey,
      type: "key",
    });
  };
  if (policy.pointer === true || keys.size > 0) {
    const pointerEvents = [
      "pointermove",
      "pointerdown",
      "pointerup",
      "pointerleave",
      "click",
    ] as const;
    for (const name of pointerEvents) {
      canvas.addEventListener(name, pointer, { signal });
    }
    canvas.addEventListener("keydown", keyboard, { signal });
    canvas.addEventListener("keyup", keyboard, { signal });
    canvas.addEventListener("blur", reset, { signal });
    canvas.addEventListener(
      "focus",
      () => {
        enqueue({ type: "focus" });
      },
      {
        signal,
      }
    );
    canvas.ownerDocument.addEventListener(
      "visibilitychange",
      () => {
        if (canvas.ownerDocument.hidden) {
          reset();
        }
      },
      { signal }
    );
    canvas.ownerDocument.defaultView?.addEventListener("blur", reset, {
      signal,
    });
  }
  return {
    acknowledge: (value: number) => {
      if (!awaiting || value !== sequence) {
        onInvalidAck();
        return;
      }
      awaiting = false;
      if (queue.length > 0 || move !== null) {
        schedule();
      }
    },
    close: () => {
      lifetime.abort();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      queue = [];
      move = null;
      if (keys.size > 0) {
        if (previousTabIndex === null) {
          canvas.removeAttribute("tabindex");
        } else {
          canvas.setAttribute("tabindex", previousTabIndex);
        }
      }
    },
  };
};
