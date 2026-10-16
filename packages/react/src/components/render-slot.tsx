import { useStore } from "@nanostores/react";
import { createSlotRuntime, buildThemeCss } from "@tailorkit/client-core";
import type {
  ControlledRenderSlotProps,
  RenderSlotProps,
  RuntimeRenderSlotProps,
  SlotRuntimeOptions,
} from "@tailorkit/client-core";
import type { SlotDefinitions, ViewDefinition } from "@tailorkit/core/schema";
import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { PrimitiveThemeContext } from "#primitives";
import { RemoteViewHost } from "#remote-view";

import { useTailorkitContext } from "./context";

export type {
  ControlledRenderSlotProps,
  RenderSlotProps,
  RenderSlotContext,
} from "@tailorkit/client-core";

type DefaultViews = Record<`/${string}`, ViewDefinition>;

export type RenderSlotComponent<
  TViews extends Record<string, ViewDefinition> = DefaultViews,
  TSlots extends SlotDefinitions = SlotDefinitions,
> = ((props: RenderSlotProps<TSlots>) => ReactNode) & {
  Controlled: (props: ControlledRenderSlotProps<TViews, TSlots>) => ReactNode;
};

const SlotRenderer = (options: SlotRuntimeOptions): ReactNode => {
  const { store, client } = useTailorkitContext(
    options.mode === "managed" ? "RenderSlot" : "RenderSlot.Controlled"
  );
  const reactId = useId();
  const [state, setState] = useState(() => ({
    runtime: createSlotRuntime(store, options),
    store,
  }));
  if (state.store !== store) {
    setState({ runtime: createSlotRuntime(store, options), store });
  }
  const { runtime } = state;
  useEffect(() => {
    runtime.setInput(options);
  }, [runtime, options]);
  const snapshot = useStore(runtime.state);
  const viewId = `tailorkit-view-${reactId.replaceAll(":", "")}`;
  const themeContext = useMemo(
    () => ({ theme: client.theme, viewId }),
    [client.theme, viewId]
  );
  if (snapshot.status === "hidden") {
    return null;
  }
  if (snapshot.status === "loading") {
    return <output>{snapshot.message}</output>;
  }
  if (snapshot.status === "error") {
    return <div role="alert">{snapshot.error.message}</div>;
  }
  return (
    <PrimitiveThemeContext.Provider value={themeContext}>
      <div data-tailorkit-view={viewId}>
        <style data-tailorkit-theme-style={viewId}>
          {buildThemeCss(viewId, client.theme)}
        </style>
        <RemoteViewHost
          key={snapshot.hostKey}
          appUrl={snapshot.appUrl}
          toolBridge={snapshot.toolBridge}
          getBackendSession={snapshot.getBackendSession}
          components={client.components}
          props={snapshot.props}
        />
      </div>
    </PrimitiveThemeContext.Provider>
  );
};

const ManagedRenderSlot = (props: RuntimeRenderSlotProps): ReactNode => (
  <SlotRenderer mode="managed" {...props} />
);

const ControlledRenderSlot = (props: ControlledRenderSlotProps): ReactNode => (
  <SlotRenderer mode="controlled" {...props} />
);

export const RenderSlot: RenderSlotComponent = Object.assign(
  ManagedRenderSlot,
  {
    Controlled: ControlledRenderSlot,
  }
);
