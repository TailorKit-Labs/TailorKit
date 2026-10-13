import {
  createTailorKitClientConfig,
  createComponentRegistry,
  createTailorKitStore,
} from "@tailorkit/client-core";
import type {
  AnyComponentDefinition,
  ComponentRenderer,
  ComponentRenderers,
  CompleteComponentRenderers,
  TailorKitClientConfig,
  TailorKitApp,
  SlotMultiple,
  TailorKitCacheOptions,
} from "@tailorkit/client-core";
import type {
  TailorKitTheme,
  ComponentDefinition,
  ComponentProps,
  ViewDefinition,
  SlotDefinitions,
  TailorKitContract,
  ToolImplementations,
} from "@tailorkit/core/schema";
import { createElement, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { TailorkitContext, useTailorkitContext } from "./components/context";
import { RenderSlot as ReactRenderSlot } from "./components/render-slot";
import type {
  ControlledRenderSlotProps,
  RenderSlotComponent,
  RenderSlotProps,
} from "./components/render-slot";
import { useApps as useRootApps } from "./hooks/use-apps";
import type { UseAppsOptions, UseAppsResult } from "./hooks/use-apps";
import { useViewContext as useRootViewContext } from "./hooks/use-view-context";
import type {
  UseViewContext,
  ViewName,
  ViewState,
} from "./hooks/use-view-context";
import { useViews as useRootViews } from "./hooks/use-views";
import type { UseViewsOptions, UseViewsResult } from "./hooks/use-views";
import type { primitives } from "./primitives";

export type { TailorKitClientConfig } from "@tailorkit/client-core";

export type { TailorKitApp } from "@tailorkit/client-core";

export interface TailorKitProviderProps {
  apps?: TailorKitApp[];
  children?: ReactNode;
}

export interface TailorKitInstance<
  TViews extends Record<string, ViewDefinition> = Record<
    string,
    ViewDefinition
  >,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
> extends TailorKitClientConfig {
  readonly $slots?: TSlots;
  readonly $views?: TViews;
  readonly Provider: (props: TailorKitProviderProps) => ReactNode;
  readonly RenderSlot: RenderSlotComponent<TViews, TSlots>;
  readonly useApps: (options?: UseAppsOptions<TScopeNames>) => UseAppsResult;
  readonly useViews: <TSlot extends keyof TSlots & string>(
    options: UseViewsOptions<TScopeNames, TSlot>
  ) => UseViewsResult<SlotMultiple<TSlots[TSlot]>>;
  readonly useViewContext: UseViewContext<TViews>;
}

type PrimitiveRenderers = typeof primitives;

type CustomComponentRenderers<
  TComponents extends Record<string, AnyComponentDefinition>,
> = {
  [
    TName in Exclude<keyof TComponents, keyof PrimitiveRenderers>
  ]?: ComponentRenderer<TComponents[TName], ReactNode>;
};

// SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
export const components = <
  TComponents extends Record<string, AnyComponentDefinition>,
>(
  _contract: { components: TComponents },
  customComponents: CustomComponentRenderers<TComponents>
): ComponentRenderers<TComponents, ReactNode> =>
  customComponents as ComponentRenderers<TComponents, ReactNode>;

interface ReactComponentRenderArgs {
  props: ComponentProps<ComponentDefinition>;
  children?: ReactNode;
}

const createReactTailorKitClient = <
  TComponents extends Record<string, AnyComponentDefinition>,
  TViews extends Record<string, ViewDefinition> = Record<string, never>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
>(options: {
  contract: TailorKitContract;
  tools?: ToolImplementations<TailorKitContract["tools"], "client">;
  assetsBaseUrl?: string | URL;
  baseUrl: string | URL;
  components?: ComponentRenderers<TComponents, ReactNode>;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitInstance<TViews, TSlots, TScopeNames> => {
  const wrappedComponents = createComponentRegistry(
    options.components ?? {},
    (renderer) =>
      function TailorKitComponent({
        children,
        ...props
      }: ReactComponentRenderArgs["props"] & { children?: ReactNode }) {
        const rendererArgs: ReactComponentRenderArgs = { props };
        if (children !== undefined) {
          rendererArgs.children = children;
        }
        // SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
        return (renderer as (args: typeof rendererArgs) => ReactNode)(
          rendererArgs
        );
      }
  );

  const clientConfig = createTailorKitClientConfig({
    ...options,
    components: wrappedComponents,
  });

  const ClientRenderSlot = (props: RenderSlotProps<TSlots>) => {
    // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
    useTailorkitContext("RenderSlot", client);
    // SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
    return createElement(ReactRenderSlot, props as RenderSlotProps);
  };

  const client: TailorKitInstance<TViews, TSlots, TScopeNames> = {
    ...clientConfig,
    Provider: function Provider({ children, apps }: TailorKitProviderProps) {
      // oxlint-disable-next-line react/hook-use-state -- The provider owns one immutable store; prop updates are applied through the store API.
      const [store] = useState(() =>
        createTailorKitStore({
          apps,
          assetsBaseUrl: client.assetsBaseUrl,
          baseUrl: client.baseUrl,
          client: clientConfig.fetchClient,
          contract: client.contract,
          tools: client.tools,
        })
      );
      useEffect(() => {
        store.setProvidedApps(apps);
      }, [store, apps]);
      useEffect(() => () => store.previews.dispose(), [store]);
      const context = useMemo(() => ({ client, store }), [store]);
      return createElement(
        TailorkitContext.Provider,
        { value: context },
        children
      );
    },
    RenderSlot: Object.assign(ClientRenderSlot, {
      Controlled: function Controlled(
        props: ControlledRenderSlotProps<TViews, TSlots>
      ) {
        useTailorkitContext("RenderSlot.Controlled", client);
        // SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
        return createElement(
          ReactRenderSlot.Controlled,
          props as ControlledRenderSlotProps
        );
      },
    }),
    useApps: function useApps(optionsValue) {
      useTailorkitContext("useApps", client);
      return useRootApps(optionsValue);
    },
    useViewContext: function useViewContext<TView extends ViewName<TViews>>(
      view: TView,
      optionsValue2: ViewState<TViews, NoInfer<TView>>
    ) {
      useTailorkitContext("useViewContext", client);
      useRootViewContext<TViews, TView>(view, optionsValue2);
    },
    useViews: function useViews<TSlot extends keyof TSlots & string>(
      optionsValue3: UseViewsOptions<TScopeNames, TSlot>
    ) {
      useTailorkitContext("useViews", client);
      // SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
      return useRootViews(optionsValue3) as UseViewsResult<
        SlotMultiple<TSlots[TSlot]>
      >;
    },
  };

  return client;
};

export const createClient = <const TContract extends TailorKitContract>(
  options: {
    contract: TContract;
    tools?: ToolImplementations<NoInfer<TContract["tools"]>, "client">;
    baseUrl: string | URL;
    assetsBaseUrl?: string | URL;
    components?: CompleteComponentRenderers<
      NoInfer<TContract["components"]>,
      ReactNode
    >;
    theme?: TailorKitTheme;
    cache?: TailorKitCacheOptions;
    fetch?: typeof fetch;
  } & (keyof ToolImplementations<TContract["tools"], "client"> extends never
    ? { tools?: ToolImplementations<TContract["tools"], "client"> }
    : { tools: ToolImplementations<TContract["tools"], "client"> })
): TailorKitInstance<
  TContract["views"],
  TContract["slots"],
  keyof TContract["scopes"] & string
> =>
  createReactTailorKitClient<
    TContract["components"],
    TContract["views"],
    TContract["slots"],
    keyof TContract["scopes"] & string
  >(options);

export type { ViewOptions } from "./hooks/use-view-context";
