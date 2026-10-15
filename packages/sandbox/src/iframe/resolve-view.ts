import type { ViewInstance } from "@tailorkit/app/client";
import { composeViewContext, getViewHierarchy } from "@tailorkit/core/views";
import type {
  ActiveView,
  ResolvedViewProps as ContextProps,
} from "@tailorkit/core/views";

const hasText = (value: string | null | undefined): value is string =>
  value !== undefined && value !== null && value.length > 0;

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

export type ResolvedViewProps =
  | (Extract<ContextProps, { status: "ready" }> & { instance?: ViewInstance })
  | (Extract<ContextProps, { status: "loading" | "error" }> & {
      instance?: never;
    });

interface ViewRequestMetadata {
  slot: string;
  declaredViews: readonly string[];
  supportedViews: readonly string[];
  instance?: ViewInstance;
}

type LayeredViewRequest = ViewRequestMetadata &
  ActiveView & { controlled?: false };

export type ViewRequest =
  | LayeredViewRequest
  | (ViewRequestMetadata & ResolvedViewProps & { controlled: true });

export interface AppViewDefinition<TNode = unknown> {
  instances?: { resolver: string };
  component: (props: ResolvedViewProps) => TNode;
}

export interface AppClient<TNode = unknown> {
  slots: Record<string, Record<string, AppViewDefinition<TNode> | false>>;
  $runtime: {
    h: (
      component: AppViewDefinition<TNode>["component"],
      props: ResolvedViewProps
    ) => TNode;
    render: (node: TNode, root: Element) => void;
  };
}

const controlledViewProps = (
  request: Extract<ViewRequest, { controlled: true }>
): ResolvedViewProps => {
  if (request.status !== "ready") {
    return { context: undefined, status: request.status, view: request.view };
  }
  if (
    request.context === null ||
    !isObjectValue(request.context) ||
    Array.isArray(request.context)
  ) {
    return { context: undefined, status: "error", view: request.view };
  }
  return { context: request.context, status: "ready", view: request.view };
};

const validateViewInstance = (
  instance: ViewInstance,
  selected: string
): void => {
  if (
    !(instance !== undefined && instance !== null) ||
    !isObjectValue(instance) ||
    !isStringValue(instance.key) ||
    !instance.key ||
    !(instance.metadata !== undefined && instance.metadata !== null) ||
    !isObjectValue(instance.metadata) ||
    Array.isArray(instance.metadata)
  ) {
    throw new TypeError(`Invalid instance for view "${selected}".`);
  }
};

export const resolveView = (client: AppClient, request: ViewRequest) => {
  const views = client.slots[request.slot];
  if (views === undefined) {
    return null;
  }
  const selected = (
    request.controlled === true
      ? [request.view]
      : getViewHierarchy(request.view)
  ).find(
    (path) =>
      request.supportedViews.includes(path) && Object.hasOwn(views, path)
  );
  if (!hasText(selected) || views[selected] === false) {
    return null;
  }
  const definition = views[selected];
  if (!definition || !isFunctionValue(definition.component)) {
    throw new TypeError(
      `TailorKit app client view "${selected}" is missing a component.`
    );
  }

  const props =
    request.controlled === true
      ? controlledViewProps(request)
      : composeViewContext(selected, request);
  if (props.status !== "ready") {
    return { component: definition.component, props };
  }
  if (definition.instances && !request.instance) {
    throw new Error(`View "${selected}" requires a selected instance.`);
  }
  if (request.instance !== undefined) {
    if (!definition.instances) {
      throw new Error(`View "${selected}" does not support instances.`);
    }
    const { instance } = request;
    validateViewInstance(instance, selected);
    return { component: definition.component, props: { ...props, instance } };
  }
  return { component: definition.component, props };
};

export const renderClient = (
  client: AppClient,
  request: ViewRequest,
  root: Element
): void => {
  const selected = resolveView(client, request);
  client.$runtime.render(
    selected ? client.$runtime.h(selected.component, selected.props) : null,
    root
  );
};

export const assertAppClient: (value: unknown) => asserts value is AppClient = (
  value
) => {
  if (
    !isObjectValue(value) ||
    !("slots" in value) ||
    !isObjectValue(value.slots) ||
    !("$runtime" in value) ||
    !isObjectValue(value.$runtime) ||
    !("h" in value.$runtime) ||
    !isFunctionValue(value.$runtime.h) ||
    !("render" in value.$runtime) ||
    !isFunctionValue(value.$runtime.render)
  ) {
    throw new TypeError(
      "TailorKit app must be built with the app builder and include slots and its bundled runtime."
    );
  }
};
