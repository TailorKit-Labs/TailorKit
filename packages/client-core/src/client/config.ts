import { flattenTools } from "@tailorkit/core/schema";
import type {
  TailorKitTheme,
  CallbackMap,
  ComponentDefinition,
  ComponentProps,
  Schema,
  TailorKitContract,
  ToolImplementations,
} from "@tailorkit/core/schema";

import type { RemoteComponentRegistry } from "#store/local/remote-view";

import { createTailorKitFetchClient } from "./fetch-client";
import type {
  TailorKitFetchClient,
  TailorKitCacheOptions,
} from "./fetch-client";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

type ClientToolTree = ToolImplementations<TailorKitContract["tools"], "client">;
const isToolHandler = (
  value: ClientToolTree[string]
): value is Exclude<ClientToolTree[string], ClientToolTree> =>
  typeof value === "function";

export type AnyComponentDefinition = ComponentDefinition<
  Schema | undefined,
  CallbackMap
>;

export type ComponentRenderer<
  TComponent extends AnyComponentDefinition,
  TNode,
> = (
  args: {
    props: ComponentProps<TComponent>;
  } & ("children" extends keyof TComponent
    ? TComponent extends { children?: true }
      ? { children?: TNode }
      : unknown
    : unknown)
) => TNode;

export type ComponentRenderers<
  TComponents extends Record<string, AnyComponentDefinition>,
  TNode,
> = {
  [TName in keyof TComponents]?: ComponentRenderer<TComponents[TName], TNode>;
};

export type CompleteComponentRenderers<
  TComponents extends Record<string, AnyComponentDefinition>,
  TNode,
> = {
  [TName in keyof TComponents]-?: ComponentRenderer<TComponents[TName], TNode>;
};

const componentTagPrefix = "tailorkit-";

export const toComponentTagName = (name: string): string =>
  `${componentTagPrefix}${name
    .replaceAll(
      /(?<lowercase>[a-z0-9])(?<uppercase>[A-Z])/gu,
      "$<lowercase>-$<uppercase>"
    )
    .replaceAll(/[\s_]+/gu, "-")
    .toLowerCase()}`;

export interface TailorKitClientConfig {
  readonly tools?: ToolImplementations<TailorKitContract["tools"], "client">;
  readonly baseUrl: string | URL;
  readonly contract: TailorKitContract;
  readonly assetsBaseUrl?: string | URL;
  readonly fetchClient?: TailorKitFetchClient;
  /** Clear cached app data and sessions after changing the host auth session. */
  readonly clearCache: () => void;
  readonly components: RemoteComponentRegistry;
  readonly theme: TailorKitTheme;
}

export type SlotMultiple<TSlot> = TSlot extends {
  multiple: infer TMultiple extends boolean;
}
  ? TMultiple
  : TSlot extends { multiple?: infer TMultiple extends boolean }
    ? TMultiple | false
    : false;

/** Build framework-independent client configuration after an adapter wraps its renderers. */
export const createTailorKitClientConfig = (options: {
  contract: TailorKitContract;
  tools?: ToolImplementations<TailorKitContract["tools"], "client">;
  assetsBaseUrl?: string | URL;
  baseUrl: string | URL;
  components?: RemoteComponentRegistry;
  theme?: TailorKitTheme;
  cache?: TailorKitCacheOptions;
  fetch?: typeof fetch;
}): TailorKitClientConfig => {
  const declarations = flattenTools(options.contract.tools);
  const visit = (tree: ClientToolTree | undefined, prefix = "") => {
    if (!tree) {
      return;
    }
    for (const [name, value] of Object.entries(tree)) {
      const path = prefix + name;
      if (isFunctionValue(value)) {
        if (declarations.get(path)?.kind !== "client") {
          throw new Error(`Undeclared client tool "${path}"`);
        }
      } else {
        visit(value, `${path}.`);
      }
    }
  };
  visit(options.tools);
  for (const [path, leaf] of declarations) {
    if (leaf.kind !== "client") {
      continue;
    }
    let value: ClientToolTree[string] | undefined = options.tools;
    for (const name of path.split(".")) {
      value =
        value && !isToolHandler(value) && Object.hasOwn(value, name)
          ? value[name]
          : undefined;
    }
    if (!isFunctionValue(value)) {
      throw new TypeError(`Missing client tool "${path}"`);
    }
  }
  const fetchClient = createTailorKitFetchClient(options);
  return {
    assetsBaseUrl: options.assetsBaseUrl,
    baseUrl: options.baseUrl,
    clearCache: () => {
      fetchClient.clear();
    },
    components: options.components ?? {},
    contract: options.contract,
    fetchClient,
    theme: options.theme ?? {},
    tools: options.tools,
  };
};

interface WrappedComponentRegistry<TRenderer> {
  [name: string]: TRenderer;
}

/** Register schema names and their remote element aliases with the same wrapped renderer. */
export const createComponentRegistry = <
  T extends RemoteComponentRegistry,
  TRenderer,
>(
  renderers: T,
  wrap: (renderer: NonNullable<T[keyof T]>) => TRenderer
): WrappedComponentRegistry<TRenderer> => {
  const components: WrappedComponentRegistry<TRenderer> = {};
  for (const name in renderers) {
    if (!Object.hasOwn(renderers, name)) {
      continue;
    }
    const renderer = renderers[name];
    if (
      renderer !== undefined &&
      renderer !== null &&
      renderer !== false &&
      renderer !== "" &&
      renderer !== 0 &&
      !Number.isNaN(renderer) &&
      renderer !== 0n
    ) {
      const component = wrap(renderer);
      components[name] = component;
      components[toComponentTagName(name)] = component;
    }
  }
  return components;
};
