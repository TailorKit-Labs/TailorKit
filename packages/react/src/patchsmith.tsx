import {
  createPatchsmithClientConfig,
  createComponentRegistry,
  createPatchsmithStore,
} from "@patchsmith/client-core";
import type {
  AnyComponentDefinition,
  ComponentRenderer,
  ComponentRenderers,
  CompleteComponentRenderers,
  PatchsmithClientConfig,
  PatchsmithApp,
  SlotMultiple,
  PatchsmithCacheOptions,
} from "@patchsmith/client-core";
import type {
  PatchsmithTheme,
  ComponentDefinition,
  ComponentProps,
  ViewDefinition,
  SlotDefinitions,
  PatchsmithContract,
  ToolImplementations,
} from "@patchsmith/core/schema";
import { createElement, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { PatchsmithContext, usePatchsmithContext } from "./components/context";
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

export type { PatchsmithClientConfig } from "@patchsmith/client-core";

export type { PatchsmithApp } from "@patchsmith/client-core";

export interface PatchsmithProviderProps {
  apps?: PatchsmithApp[];
  children?: ReactNode;
}

export interface PatchsmithInstance<
  TViews extends Record<string, ViewDefinition> = Record<
    string,
    ViewDefinition
  >,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
> extends PatchsmithClientConfig {
  readonly $slots?: TSlots;
  readonly $views?: TViews;
  readonly Provider: (props: PatchsmithProviderProps) => ReactNode;
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
  /* oxlint-disable typescript/no-unsafe-type-assertion -- The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary. */
  customComponents as ComponentRenderers<TComponents, ReactNode>;
/* oxlint-enable typescript/no-unsafe-type-assertion */

interface ReactComponentRenderArgs {
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This empty mapped type is intentional: its keyof is never, so generic defaults do not introduce arbitrary keys.
  props: ComponentProps<ComponentDefinition>;
  children?: ReactNode;
}

const createReactPatchsmithClient = <
  TComponents extends Record<string, AnyComponentDefinition>,
  TViews extends Record<string, ViewDefinition> = Record<string, never>,
  TSlots extends SlotDefinitions = SlotDefinitions,
  TScopeNames extends string = string,
>(options: {
  contract: PatchsmithContract;
  tools?: ToolImplementations<PatchsmithContract["tools"], "client">;
  assetsBaseUrl?: string | URL;
  baseUrl: string | URL;
  components?: ComponentRenderers<TComponents, ReactNode>;
  theme?: PatchsmithTheme;
  cache?: PatchsmithCacheOptions;
  fetch?: typeof fetch;
}): PatchsmithInstance<TViews, TSlots, TScopeNames> => {
  const wrappedComponents = createComponentRegistry(
    options.components ?? {},
    (renderer) =>
      // oxlint-disable-next-line typescript/promise-function-async -- Client components must render synchronously; ReactNode also permits Promise results for server components.
      function PatchsmithComponent({
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

  const clientConfig = createPatchsmithClientConfig({
    ...options,
    components: wrappedComponents,
  });

  const ClientRenderSlot = (props: RenderSlotProps<TSlots>) => {
    // oxlint-disable-next-line no-use-before-define -- This deferred callback runs after initialization; the definitions are mutually dependent.
    usePatchsmithContext("RenderSlot", client);
    // SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
    return createElement(ReactRenderSlot, props as RenderSlotProps);
  };

  const client: PatchsmithInstance<TViews, TSlots, TScopeNames> = {
    ...clientConfig,
    Provider: function Provider({ children, apps }: PatchsmithProviderProps) {
      // oxlint-disable-next-line react/hook-use-state -- The provider owns one immutable store; prop updates are applied through the store API.
      const [store] = useState(() =>
        createPatchsmithStore({
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
      const context = useMemo(() => ({ client, store }), [store]);
      return createElement(
        PatchsmithContext.Provider,
        { value: context },
        children
      );
    },
    RenderSlot: Object.assign(ClientRenderSlot, {
      Controlled: function Controlled(
        props: ControlledRenderSlotProps<TViews, TSlots>
      ) {
        usePatchsmithContext("RenderSlot.Controlled", client);
        // SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
        return createElement(
          ReactRenderSlot.Controlled,
          /* oxlint-disable typescript/no-unsafe-type-assertion -- The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary. */
          props as ControlledRenderSlotProps
          /* oxlint-enable typescript/no-unsafe-type-assertion */
        );
      },
    }),
    useApps: function useApps(optionsValue) {
      usePatchsmithContext("useApps", client);
      return useRootApps(optionsValue);
    },
    useViewContext: function useViewContext<TView extends ViewName<TViews>>(
      view: TView,
      optionsValue2: ViewState<TViews, NoInfer<TView>>
    ) {
      usePatchsmithContext("useViewContext", client);
      useRootViewContext<TViews, TView>(view, optionsValue2);
    },
    useViews: function useViews<TSlot extends keyof TSlots & string>(
      optionsValue3: UseViewsOptions<TScopeNames, TSlot>
    ) {
      usePatchsmithContext("useViews", client);
      // SAFETY: The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary.
      return (
        /* oxlint-disable typescript/no-unsafe-type-assertion -- The wrapper preserves the declared component or slot props and changes only the rendering adapter; the generic key-to-props relationship is erased at this boundary. */
        useRootViews(optionsValue3) as UseViewsResult<
          SlotMultiple<TSlots[TSlot]>
        >
        /* oxlint-enable typescript/no-unsafe-type-assertion */
      );
    },
  };

  return client;
};

export const createClient = <const TContract extends PatchsmithContract>(
  options: {
    contract: TContract;
    tools?: ToolImplementations<NoInfer<TContract["tools"]>, "client">;
    baseUrl: string | URL;
    assetsBaseUrl?: string | URL;
    components?: CompleteComponentRenderers<
      NoInfer<TContract["components"]>,
      ReactNode
    >;
    theme?: PatchsmithTheme;
    cache?: PatchsmithCacheOptions;
    fetch?: typeof fetch;
  } & (keyof ToolImplementations<TContract["tools"], "client"> extends never
    ? { tools?: ToolImplementations<TContract["tools"], "client"> }
    : { tools: ToolImplementations<TContract["tools"], "client"> })
): PatchsmithInstance<
  TContract["views"],
  TContract["slots"],
  keyof TContract["scopes"] & string
> =>
  createReactPatchsmithClient<
    TContract["components"],
    TContract["views"],
    TContract["slots"],
    keyof TContract["scopes"] & string
  >(options);

export type { ViewOptions } from "./hooks/use-view-context";
