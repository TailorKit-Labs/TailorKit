import type { LucideIconName } from "./lucide-names.generated";

export type { LucideIconName } from "./lucide-names.generated";

export interface IconOptions {
  library: "lucide";
}

export interface IconProps {
  /** Kebab-case icon name, for example `arrow-right`. */
  name: LucideIconName;
  /** Size in pixels. Defaults to 24. */
  size?: number;
}

export const iconNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const lucideVersion = "1.55.0";

export const validateIconOptions = (options: IconOptions): void => {
  if (options.library !== "lucide") {
    throw new Error("Unsupported icon library");
  }
};

export type IconTag =
  | "circle"
  | "ellipse"
  | "line"
  | "path"
  | "polygon"
  | "polyline"
  | "rect";
export type IconNode = [IconTag, Record<string, number | string>];
export interface IconData {
  size: number;
  nodes: IconNode[];
}

const tags = new Set<string>([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
]);
const attributes = new Set([
  "cx",
  "cy",
  "d",
  "height",
  "key",
  "points",
  "r",
  "rx",
  "ry",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This guard is used only while parsing untrusted catalogue JSON; every member is validated before use.
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isIconTag = <TValue>(value: TValue): value is TValue & IconTag =>
  typeof value === "string" && tags.has(value);

/** Accept geometry only: no markup, styles, URLs, event handlers, or arbitrary SVG tags. */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This is the catalogue JSON I/O parser; tags and geometric attributes must be checked before rendering. */
const isAttributeValue = (value: unknown): value is number | string =>
  (typeof value === "string" && value.length <= 4096) ||
  (typeof value === "number" && Number.isFinite(value));

export const parseIconData = (value: unknown): IconData => {
  if (
    !isObject(value) ||
    typeof value.size !== "number" ||
    !Number.isFinite(value.size) ||
    value.size < 1 ||
    value.size > 1024 ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 64
  ) {
    throw new Error("Invalid icon data");
  }
  const nodes: IconNode[] = [];
  for (const node of value.nodes) {
    if (
      !Array.isArray(node) ||
      node.length !== 2 ||
      !isIconTag(node[0]) ||
      !isObject(node[1])
    ) {
      throw new Error("Invalid icon node");
    }
    const props: Record<string, number | string> = {};
    for (const [name, attribute] of Object.entries(node[1])) {
      if (
        !(
          attributes.has(name) ||
          (name === "fill" && attribute === "currentColor")
        ) ||
        !isAttributeValue(attribute)
      ) {
        throw new Error("Invalid icon attribute");
      }
      props[name] = attribute;
    }
    nodes.push([node[0], props]);
  }
  return { nodes, size: value.size };
};

/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof */
