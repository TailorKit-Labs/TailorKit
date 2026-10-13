const isObjectValue = <TValue>(
  value: TValue
): value is TValue & (object | null) => typeof value === "object";
// Each view schema owns its field values; composition only merges checked object containers.
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- A schema-agnostic composer cannot narrow arbitrary registered schema outputs.
export type ViewContextValues = Record<string, unknown>;

export type ViewStatus = "ready" | "loading" | "error";

export interface ViewLayer {
  path: string;
  context: unknown;
  status: ViewStatus;
}

export interface ActiveView {
  view: string;
  layers: ViewLayer[];
}

/** Includes the requested path, followed by its parents through the root. */
export const getViewHierarchy = (path: string): string[] => {
  const hierarchy = [path];
  let current = path;
  while (current !== "/") {
    const separator = current.lastIndexOf("/");
    current = separator <= 0 ? "/" : current.slice(0, separator);
    hierarchy.push(current);
  }
  return hierarchy;
};

export const isViewAncestor = (ancestor: string, path: string): boolean =>
  ancestor === "/" || ancestor === path || path.startsWith(`${ancestor}/`);

export const getViewDepth = (path: string): number =>
  path.split("/").filter(Boolean).length;

/** Context supplied to the selected view after combining its registered ancestors. */
export interface ReadyViewProps {
  view: string;
  status: "ready";
  context: ViewContextValues;
}

export type ResolvedViewProps =
  | ReadyViewProps
  | { view: string; status: "loading" | "error"; context?: never };

export const composeViewContext = (
  selected: string,
  request: { layers: readonly ViewLayer[]; declaredViews: readonly string[] }
): ResolvedViewProps => {
  let status: ViewStatus = "ready";
  const context: ViewContextValues = {};
  for (const path of getViewHierarchy(selected).toReversed()) {
    const layer = request.layers.find((entry) => entry.path === path);
    if (!layer) {
      if (request.declaredViews.includes(path) || path === selected) {
        status = "error";
      }
      continue;
    }
    if (layer.status === "error") {
      status = "error";
    } else if (layer.status === "loading" && status !== "error") {
      status = "loading";
    }
    if (layer.status !== "ready" || layer.context === undefined) {
      continue;
    }
    if (
      layer.context === null ||
      !isObjectValue(layer.context) ||
      Array.isArray(layer.context)
    ) {
      status = "error";
      continue;
    }
    for (const [key, value] of Object.entries(layer.context)) {
      if (Object.hasOwn(context, key)) {
        throw new Error(`Duplicate view context field "${key}".`);
      }
      Object.defineProperty(context, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  const props: ResolvedViewProps =
    status === "ready"
      ? { context, status, view: selected }
      : { context: undefined, status, view: selected };
  return props;
};
