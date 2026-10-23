import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createContext, h } from "preact";
import type {
  ComponentChild,
  ComponentChildren,
  ComponentType,
  VNode,
} from "preact";
import { useContext } from "preact/hooks";

import type { FunctionCalls, Identity } from "./server/functions";

const isFunctionValue = <TValue>(
  value: TValue
): value is TValue & RemoteCallbackOperation => typeof value === "function";

// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Generated bindings augment this interface.
export interface PatchsmithViews {}

// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Generated bindings augment this interface.
export interface PatchsmithSlots {}

// Filled by the generated host bindings using a type-only link to the app server.
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Generated bindings augment this interface.
export interface PatchsmithServerFunctions {}

// Registered view schemas own these heterogeneous field types; shared adapters only forward or encode them.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Context and instance metadata remain opaque until their owning schema consumes them.
export type ViewDataFields = Record<string, unknown>;

interface SerializedDomViewProps extends ViewDataFields {
  "data-patchsmith-props"?: string;
  "data-patchsmith-callbacks"?: string;
}

interface CompiledViewMetadata {
  instances?: { cache?: "static"; resolver: string };
}

export interface ViewInstance<TData = unknown> {
  key: string;
  metadata: ViewDataFields;
  data: TData;
}

export interface InstanceResolverContext<TPath extends AppViewPath> {
  context: ViewContext<TPath>;
  identity: Identity;
  signal: AbortSignal;
  queries: FunctionCalls<PatchsmithServerFunctions, "query">;
}

/** Static instances are evaluated during the build and published with the deployment. */
export type ViewInstances<
  TPath extends AppViewPath,
  TSchema extends StandardSchemaV1,
> = { dataSchema: TSchema } & (
  | {
      cache: "static";
      resolve: () =>
        | ViewInstance<StandardSchemaV1.InferInput<TSchema>>[]
        | Promise<ViewInstance<StandardSchemaV1.InferInput<TSchema>>[]>;
    }
  | {
      cache?: "none";
      /** Runs on the app server. Only registered queries are available. */
      resolve: (
        context: InstanceResolverContext<TPath>
      ) =>
        | ViewInstance<StandardSchemaV1.InferInput<TSchema>>[]
        | Promise<ViewInstance<StandardSchemaV1.InferInput<TSchema>>[]>;
    }
);

// oxlint-disable-next-line typescript/no-redundant-type-constituents -- Declaration merging may add symbol or numeric keys; the public view and slot names remain string keys.
export type SlotName = keyof PatchsmithSlots & string;

// oxlint-disable-next-line typescript/no-redundant-type-constituents -- Declaration merging may add symbol or numeric keys; the public view and slot names remain string keys.
export type ViewPath = Extract<keyof PatchsmithViews & string, `/${string}`>;

export type AppViewPath = ViewPath;

export type ViewProps<TPath extends ViewPath> =
  PatchsmithViews[TPath] extends object
    ? PatchsmithViews[TPath]
    : Record<string, never>;

export type ViewPropsForPath<TPath extends AppViewPath> = TPath extends ViewPath
  ? ViewProps<TPath>
  : never;

export type ViewContext<TPath extends AppViewPath> =
  ViewPropsForPath<TPath> extends { context: infer TContext }
    ? TContext
    : Record<string, never>;

export type View<TProps extends object = Record<string, never>> = (
  props: TProps
) => ComponentChild;

export type ViewRuntimeProps<TPath extends AppViewPath, TData = unknown> =
  | {
      context: ViewContext<TPath>;
      view: TPath;
      status: "ready";
      instance?: ViewInstance<TData>;
    }
  | {
      context?: never;
      view: TPath;
      status: "loading";
      instance?: never;
    }
  | {
      context?: never;
      view: TPath;
      status: "error";
      instance?: never;
    };

export interface ViewDefinition<
  TPath extends AppViewPath = AppViewPath,
  TData = unknown,
  TSlot extends SlotName = SlotName,
> {
  component: View<ViewRuntimeProps<TPath>>;
  path: TPath;
  slot: TSlot;
  useContext: () => ViewContext<TPath>;
  /** The selected instance, with data inferred from instances.dataSchema. */
  useInstance: () => ViewInstance<TData>;
  /** Build-only lookup key connecting this view to its extracted server implementation. */
  instances?: { cache?: "static"; resolver: string };
}

export type SlotView<TSlot extends SlotName> = PatchsmithSlots[TSlot] extends {
  views: infer TViews;
}
  ? Extract<TViews, AppViewPath>
  : never;

type SlotInstanceDefinition<TSlot extends SlotName> =
  PatchsmithSlots[TSlot] extends {
    multiple: true;
  }
    ? { instances: { cache?: "static"; resolver: string } }
    : { instances?: never };

type SlotDefinitions = {
  [V in SlotName]?: Partial<{
    [P in SlotView<V>]:
      | (ViewDefinition<P, unknown, V> & SlotInstanceDefinition<V>)
      | false;
  }>;
};

export interface PatchsmithClient<
  TSlots extends SlotDefinitions = SlotDefinitions,
> {
  slots: TSlots;
}

export interface PatchsmithClientMeta {
  preactVersion: string;
}

export interface PatchsmithClientRuntime {
  h: typeof h;
  render: (
    vnode: VNode | null,
    parent: Element | Document | ShadowRoot | DocumentFragment
  ) => void;
}

export type PatchsmithClientWithMeta<
  TViews extends SlotDefinitions = SlotDefinitions,
> = PatchsmithClient<TViews> & {
  $meta: PatchsmithClientMeta;
  $runtime: PatchsmithClientRuntime;
};

type ViewOptions<
  TPath extends AppViewPath,
  TSlot extends SlotName,
  TSchema extends StandardSchemaV1,
> = {
  [S in TSlot]: {
    slot: S;
    view: TPath;
    component: View;
  } & (TPath extends SlotView<S>
    ? unknown
    : { readonly __patchsmith_error__: "View is not supported by this slot" }) &
    (PatchsmithSlots[S] extends { multiple: true }
      ? { instances: ViewInstances<TPath, TSchema> }
      : { instances?: never });
}[TSlot];

/** In .view.tsx files, the builder supplies the slot and filename-derived path.
 * An explicit view must match the file path and provides precise host context typing. */
export function defineView<
  const TPath extends AppViewPath = AppViewPath,
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
>(options: {
  slot?: never;
  view?: TPath;
  component: View;
  instances?: ViewInstances<TPath, TSchema>;
}): ViewDefinition<TPath, StandardSchemaV1.InferOutput<TSchema>>;
export function defineView<
  const TPath extends AppViewPath,
  const TSlot extends SlotName,
  TSchema extends StandardSchemaV1,
>(
  options: ViewOptions<TPath, TSlot, TSchema>
): ViewDefinition<TPath, StandardSchemaV1.InferOutput<TSchema>, TSlot> &
  SlotInstanceDefinition<TSlot>;

export function defineView<
  TPath extends AppViewPath,
  TSchema extends StandardSchemaV1,
>(options: {
  slot?: SlotName;
  view?: TPath;
  component: View;
  instances?: ViewInstances<TPath, TSchema>;
}): ViewDefinition<TPath, StandardSchemaV1.InferOutput<TSchema>> {
  if (!options.slot || !options.view) {
    throw new Error(
      "Views without a slot or path must be compiled from a .view.tsx file by the Patchsmith app build."
    );
  }

  const path = options.view;

  const Context = createContext<{
    context: ViewContext<TPath>;
    instance?: ViewInstance;
  } | null>(null);

  // SAFETY: Generated bindings associate this view path with its context and instance schema; the adapter retains that relationship while erasing renderer generics.
  const instances =
    /* oxlint-disable typescript/no-unsafe-type-assertion -- Generated bindings associate this view path with its context and instance schema; the adapter retains that relationship while erasing renderer generics. */
    options.instances as { cache?: "static"; resolver?: string } | undefined;

  /* oxlint-enable typescript/no-unsafe-type-assertion */
  if (
    instances &&
    !(
      instances.resolver !== undefined &&
      instances.resolver !== null &&
      instances.resolver !== ""
    )
  ) {
    throw new Error(
      "View instance resolvers must be compiled with the Patchsmith app build."
    );
  }

  const View = (props: ViewRuntimeProps<TPath>) => {
    if (props.status !== "ready") {
      return null;
    }

    if (instances && !props.instance) {
      throw new Error(
        `View "${path}" requires a selected instance. Pass instanceKey to RenderSlot or instance to RenderSlot.Controlled.`
      );
    }

    // SAFETY: Generated bindings associate this view path with its context and instance schema; the adapter retains that relationship while erasing renderer generics.
    return h(
      Context.Provider,
      {
        value: {
          context: props.context,
          instance: props.instance,
        },
      },
      h(
        /* oxlint-disable typescript/no-unsafe-type-assertion -- Generated bindings associate this view path with its context and instance schema; the adapter retains that relationship while erasing renderer generics. */
        options.component as ComponentType<object>,
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        {
          key: props.instance?.key,
        }
      )
    );
  };

  const instanceMetadata: CompiledViewMetadata = {};

  if (
    instances?.resolver !== undefined &&
    instances?.resolver !== null &&
    instances?.resolver !== ""
  ) {
    instanceMetadata.instances = { resolver: instances.resolver };

    if (instances.cache === "static") {
      instanceMetadata.instances.cache = "static";
    }
  }

  // SAFETY: Generated bindings associate this view path with its context and instance schema; the adapter retains that relationship while erasing renderer generics.
  return {
    ...instanceMetadata,
    component: View,
    path,
    slot: options.slot,

    useContext: () => {
      const context = useContext(Context);

      if (context === null) {
        throw new Error(
          `View context is only available while rendering "${path}".`
        );
      }

      return context.context;
    },
    useInstance: () => {
      const value = useContext(Context);

      if (!value?.instance) {
        throw new Error(
          `View instance is only available while rendering an instance of "${path}".`
        );
      }

      return value.instance;
    },
  };
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Callback values are owned by the host contract; the sandbox bridge forwards them without interpreting their heterogeneous schemas.
export type RemoteCallbackOperation = (...inputs: unknown[]) => unknown;

export interface RemoteCallbackEvent {
  detail: unknown[];
  respondWith: (operation: RemoteCallbackOperation) => void;
}

const componentTagPrefix = "patchsmith-";

const toComponentTagName = (name: string): string =>
  `${componentTagPrefix}${name
    .replaceAll(
      /(?<lowercase>[a-z0-9])(?<uppercase>[A-Z])/gu,
      "$<lowercase>-$<uppercase>"
    )
    .replaceAll(/[\s_]+/gu, "-")
    .toLowerCase()}`;

const toCallbackEventName = (name: string): string =>
  `patchsmithcallback${name.replaceAll(/[^A-Za-z0-9_$]/gu, "").toLowerCase()}`;

const toEventProp = (event: string): string => `on${event}`;

export const createRemoteComponent = <
  TProps extends object,
  TChildren extends boolean = false,
>(
  name: string,
  options: { callbacks?: Record<string, number>; children?: TChildren } = {}
): View<
  TProps & { children?: TChildren extends true ? ComponentChildren : never }
> => {
  const tagName = toComponentTagName(name);
  const callbacks = options.callbacks ?? {};

  return function RemoteComponent({ children, ...props }) {
    // SAFETY: Generated bindings associate this view path with its context and instance schema; the adapter retains that relationship while erasing renderer generics.
    const nextProps: SerializedDomViewProps = { ...props };

    const callbackMap: Record<
      string,
      { callback: string; inputCount: number }
    > = {};

    for (const [key, inputCount] of Object.entries(callbacks)) {
      const operation = nextProps[key];
      Reflect.deleteProperty(nextProps, key);

      if (!isFunctionValue(operation)) {
        continue;
      }

      const eventName = toCallbackEventName(key);
      callbackMap[eventName] = { callback: key, inputCount };
      nextProps[toEventProp(eventName)] = (event: RemoteCallbackEvent) => {
        event.respondWith(() =>
          operation(...event.detail.slice(0, inputCount))
        );
      };
    }

    const serializedProps = Object.fromEntries(
      Object.entries(nextProps).filter(([, value]) => !isFunctionValue(value))
    );

    nextProps["data-patchsmith-props"] = JSON.stringify(serializedProps);

    if (Object.keys(callbackMap).length > 0) {
      nextProps["data-patchsmith-callbacks"] = JSON.stringify(callbackMap);
    }

    return h(
      tagName,
      nextProps,
      options.children === true ? children : undefined
    );
  };
};
