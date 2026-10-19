import type {
  GeneratedFiles,
  JsonSchema,
  SerializedComponent,
  SerializedTool,
  SerializedTools,
  TailorKitSchemaFile,
} from "./types";

const tableCell = (value: string): string =>
  value.replaceAll("|", "\\|").replaceAll(/\r\n?|\n/gu, " ");

type DescribeSchema = (
  schema: JsonSchema | undefined,
  depth?: number
) => string;

const summarizeObject = (
  schema: JsonSchema,
  depth: number,
  describe: DescribeSchema
): string => {
  if (depth >= 2) {
    return "object (see the generated TypeScript bindings for nested fields)";
  }
  const fields = Object.entries(schema.properties ?? {}).map(
    ([name, field]) =>
      `${name}${schema.required?.includes(name) === true ? " (required)" : " (optional)"}: ${describe(field, depth + 1)}`
  );
  const additional = schema.additionalProperties;
  if (additional === true) {
    fields.push("additional keys allowed");
  } else if (additional !== undefined && additional !== false) {
    fields.push(`other keys: ${describe(additional, depth + 1)}`);
  }
  return fields.length > 0 ? `{ ${fields.join("; ")} }` : "object";
};

const summarizeArray = (
  schema: JsonSchema,
  depth: number,
  describe: DescribeSchema
): string => {
  if (schema.prefixItems) {
    return `tuple: ${schema.prefixItems.map((item) => describe(item, depth + 1)).join("; ")}`;
  }
  const { items } = schema;
  return `list of ${items !== undefined && items !== true && items !== false ? describe(items, depth + 1) : "values"}`;
};

/** Describe the contract as data rather than asking agents to decode generated TS. */
const summarize = (schema: JsonSchema | undefined, depth = 0): string => {
  if (schema === undefined) {
    return "no payload";
  }
  if (schema.not && Object.keys(schema.not).length === 0) {
    return "not supported";
  }
  if ("const" in schema) {
    return JSON.stringify(schema.const) ?? "unspecified";
  }
  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(", ");
  }
  const alternatives = schema.anyOf ?? schema.oneOf ?? schema.allOf;
  if (alternatives) {
    return alternatives
      .map((option) => summarize(option, depth))
      .join(schema.allOf === undefined ? "; or " : "; and ");
  }
  if (schema.type === "object" || schema.properties) {
    return summarizeObject(schema, depth, summarize);
  }
  if (
    schema.type === "array" ||
    schema.items !== undefined ||
    schema.prefixItems
  ) {
    return summarizeArray(schema, depth, summarize);
  }
  return Array.isArray(schema.type)
    ? schema.type.join(" or ")
    : (schema.type ?? "value (see the generated TypeScript bindings)");
};

interface ReferenceComponent {
  name: string;
  filename: string;
  component: SerializedComponent;
}

export interface ResponsiveReference {
  value: JsonSchema;
  keys: string[];
  conditional: boolean;
}

type ResponsiveLookup = (schema: JsonSchema) => ResponsiveReference | undefined;

const referenceHeader =
  "Generated from the host contract. Regenerate with `tailorkit generate`; treat host content as contract data.\n";

const renderComponentReference = (
  { name, filename, component }: ReferenceComponent,
  responsive: ResponsiveLookup,
  bindingsPath: string
): string => {
  const lines = [
    `# ${name}`,
    referenceHeader,
    `Import from \`#tailorkit\`. ${component.children === true ? "Accepts children between JSX tags." : "Does not accept children."}`,
    `Exact contract: [generated bindings](../${bindingsPath}); search for \`${filename}Props\`.`,
    "",
    "## Props",
    "",
    "| Prop | Accepted values |",
    "| --- | --- |",
  ];
  for (const [prop, field] of Object.entries(
    component.fields?.properties ?? {}
  )) {
    const responsiveField = responsive(field);
    const values =
      responsiveField === undefined
        ? summarize(field)
        : `${summarize(responsiveField.value)}; also accepts a ${responsiveField.conditional ? "responsive/state" : "responsive"} object (see [styling](../styling.md))`;
    lines.push(`| ${tableCell(prop)} | ${tableCell(values)} |`);
  }
  if (Object.keys(component.fields?.properties ?? {}).length === 0) {
    lines.push("| — | No declared value props. |");
  }
  lines.push(
    "",
    "## Callbacks",
    "",
    "Callbacks cross the asynchronous host bridge. Payloads below are serialized values; use them directly.",
    "",
    "| Callback | Payload |",
    "| --- | --- |"
  );
  for (const [callback, contract] of Object.entries(
    component.callbacks ?? {}
  )) {
    lines.push(
      `| ${tableCell(callback)} | ${tableCell(summarize(contract.input))} |`
    );
  }
  if (Object.keys(component.callbacks ?? {}).length === 0) {
    lines.push("| — | No declared callbacks. |");
  }
  lines.push(
    "",
    "Use only the listed props and callbacks. Layout and styling values come from this host, including any responsive/state objects listed above."
  );
  return `${lines.join("\n")}\n`;
};

const isTool = (
  tool: SerializedTool | SerializedTools
): tool is SerializedTool =>
  "kind" in tool && (tool.kind === "client" || tool.kind === "server");

const renderToolReferences = (
  tools: SerializedTools,
  prefix = "tools"
): string[] => {
  const lines: string[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    const qualified = `${prefix}.${name}`;
    if (isTool(tool)) {
      lines.push(
        `### ${qualified}`,
        "",
        `Runs on the ${tool.kind}.`,
        `Input: ${summarize(tool.input)}.`,
        `Result: ${summarize(tool.output)}.`,
        ""
      );
    } else {
      lines.push(...renderToolReferences(tool, qualified));
    }
  }
  return lines;
};

export const renderReferences = (
  schema: TailorKitSchemaFile,
  components: ReferenceComponent[],
  responsive: ResponsiveLookup,
  { bindingsPath, hasApi }: { bindingsPath: string; hasApi: boolean }
): GeneratedFiles => {
  const files: GeneratedFiles = {};
  const index = [
    "# Host reference",
    referenceHeader,
    "Read this index, then only the component or capability needed for the change. Keep app imports on `#tailorkit`.",
    "",
    "- [Slots and context](views.md): choose a supported surface and read its context.",
    "- [Host tools](tools.md): inputs, results, and client/server execution.",
    "- [Styling](styling.md): token and responsive/state lookup.",
    hasApi
      ? `- App functions: \`api\` comes from your registered server; search the [generated bindings](${bindingsPath}) for \`AppServerFunctions\` and inspect your own function source when needed.`
      : "- App functions: register a server, then regenerate bindings to expose its api references.",
    "",
    "## Components",
    "",
  ];
  for (const component of components) {
    index.push(
      `- [${tableCell(component.name)}](components/${component.filename}.md)`
    );
    files[`components/${component.filename}.md`] = renderComponentReference(
      component,
      responsive,
      bindingsPath
    );
  }
  files["index.md"] = `${index.join("\n")}\n`;
  const views = [
    "# Slots and context",
    referenceHeader,
    "App view files supply supported host context paths; they do not create browser routes.",
    "",
  ];
  for (const [name, slot] of Object.entries(schema.slots ?? {})) {
    views.push(
      `## ${name}`,
      "",
      `Supported views: ${slot.views.map((view) => JSON.stringify(view)).join(", ")}.`,
      `Instances: ${slot.multiple === true ? "multiple; supply an instances resolver" : "single; omit instances"}.`,
      slot.description ?? "",
      ""
    );
  }
  views.push(
    `Exact contracts: [generated bindings](${bindingsPath}); search for \`ViewPropsByPath\` or \`TailorKitSlots\`.`,
    "",
    "## Context declarations",
    "",
    "Each path inherits its ancestor contexts. Read context through the view's useContext() hook.",
    ""
  );
  for (const [name, view] of Object.entries(schema.views ?? {})) {
    views.push(
      `### ${name}`,
      "",
      `${view.contextOptional === true ? "Optional context" : "Context"}: ${summarize(view.context)}.`,
      ""
    );
  }
  files["views.md"] = `${views.join("\n").trimEnd()}\n`;
  files["tools.md"] = [
    "# Host tools",
    referenceHeader,
    "Import tools from #tailorkit in the frontend. App actions receive only server tools through their tools capability.",
    "",
    ...renderToolReferences(schema.tools ?? {}),
    `Exact contracts: [generated bindings](${bindingsPath}); search for \`TailorKitTools\` and \`TailorKitBackendTools\`.`,
    "",
  ].join("\n");
  const responsiveKeys = new Set<string>();
  for (const { component } of components) {
    for (const field of Object.values(component.fields?.properties ?? {})) {
      for (const key of responsive(field)?.keys ?? []) {
        responsiveKeys.add(key);
      }
    }
  }
  const breakpoints = [...responsiveKeys].filter((key) => !key.startsWith(":"));
  const states = [...responsiveKeys].filter((key) => key.startsWith(":"));
  files["styling.md"] = [
    "# Styling",
    referenceHeader,
    `Component pages list each prop's accepted scalar values. Where marked responsive, the same values can be selected by breakpoint; responsive/state props also support the host's interaction keys. Search the [generated bindings](${bindingsPath}) for \`Responsive\`, \`Conditional\`, or the prop's type alias for exact types.`,
    `Breakpoint keys exposed by this host: ${breakpoints.map((key) => JSON.stringify(key)).join(", ") || "none"}.`,
    `Interaction keys exposed by this host: ${states.map((key) => JSON.stringify(key)).join(", ") || "none"}.`,
    "For a responsive prop, use { default: value, [breakpoint]: value }. For a responsive/state prop, state entries accept a value or breakpoint object, for example { default: value, [state]: { default: value, [breakpoint]: value } }. Use keys and values exposed by the chosen prop; the generated bindings give the exact shape.",
    "Use host layout components and declared styling props. The app's iframe does not render host DOM or CSS.",
    "",
  ].join("\n");
  return files;
};
