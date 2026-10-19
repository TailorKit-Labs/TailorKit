import type { SerializedComponent } from "./types";

/** Examples use generated types for caller-supplied values instead of guessing required data. */
export const componentExample = (
  identifier: string,
  children: boolean,
  required: string[]
): string => {
  const tag = /^[a-z]/u.test(identifier) ? "Component" : identifier;
  const imported = tag === identifier ? identifier : `${identifier} as ${tag}`;
  const props =
    required.length > 0
      ? `${identifier}Props & Required<Pick<${identifier}Props, ${required.map((name) => JSON.stringify(name)).join(" | ")}>>`
      : `${identifier}Props`;
  return [
    "## Usage",
    "",
    "Supply required values from app state or validated data. Children belong between tags only when supported.",
    "",
    "```tsx",
    `import { ${imported} } from "#tailorkit";`,
    `import type { ${identifier}Props } from "#tailorkit";`,
    "",
    `export const Example = (props: ${props}) => (`,
    children
      ? `  <${tag} {...props}>Example content</${tag}>`
      : `  <${tag} {...props} />`,
    ");",
    "```",
  ].join("\n");
};

export const valueCallbackExample = (
  identifier: string,
  component: SerializedComponent
): string => {
  const value = component.fields?.properties?.value;
  if (
    value?.type !== "string" ||
    value.enum !== undefined ||
    "const" in value
  ) {
    return "";
  }
  const callback = Object.entries(component.callbacks ?? {}).find(
    ([, contract]) =>
      contract.input?.properties?.value?.type === "string" &&
      contract.input.required?.includes("value") === true
  );
  if (callback === undefined) {
    return "";
  }
  const [name] = callback;
  return [
    "",
    "### Local value and callback",
    "",
    "Call this hook unconditionally at the top of a component and spread its returned props into the control. The callback receives a serialized value, not a DOM event. Changing initialValue alone does not reset a dirty draft; key the editor by record ID when a record change should reset it.",
    "",
    "```ts",
    'import { useState } from "preact/hooks";',
    `import type { ${identifier}Props } from "#tailorkit";`,
    `export const useValue = (initialValue: string): Pick<${identifier}Props, "value" | ${JSON.stringify(name)}> => {`,
    "  const [value, setValue] = useState(initialValue);",
    `  return { value, ${JSON.stringify(name)}: ({ value }) => setValue(value) };`,
    "};",
    "```",
  ].join("\n");
};

export const stylingExample = (
  identifier: string,
  prop: string,
  tokens: string[],
  keys: string[]
): string => {
  const [base, alternate = base] = tokens;
  if (base === undefined || !keys.includes("default")) {
    return "";
  }
  const breakpoint = keys.find(
    (key) => key !== "default" && !key.startsWith(":")
  );
  const state = keys.find((key) => key.startsWith(":"));
  const values = [`default: ${JSON.stringify(base)}`];
  if (breakpoint !== undefined) {
    values.push(`${JSON.stringify(breakpoint)}: ${JSON.stringify(alternate)}`);
  }
  if (state !== undefined) {
    values.push(`${JSON.stringify(state)}: ${JSON.stringify(alternate)}`);
  }
  return [
    "",
    "### Responsive styling example",
    "",
    "These tokens and keys come from this prop's schema; other props may accept different values.",
    "",
    "```ts",
    `import type { ${identifier}Props } from "#tailorkit";`,
    `export const styles: Pick<${identifier}Props, ${JSON.stringify(prop)}> = {`,
    `  ${JSON.stringify(prop)}: { ${values.join(", ")} },`,
    "};",
    "```",
  ].join("\n");
};

export const toolExample = (segments: string[], hasInput: boolean): string => {
  const reference = `tools${segments.map((segment) => `[${JSON.stringify(segment)}]`).join("")}`;
  const parameter = hasInput ? `input: Parameters<typeof ${reference}>[0]` : "";
  return [
    "```ts",
    'import { tools } from "#tailorkit";',
    "",
    `export const run = async (${parameter}) =>`,
    `  await ${reference}(${hasInput ? "input" : ""});`,
    "```",
  ].join("\n");
};

export const viewExample = (
  slot: string,
  view: string,
  multiple: boolean
): string => {
  const lines = [
    "```tsx",
    'import "#tailorkit";',
    'import { defineView } from "tailorkit/client";',
  ];
  if (multiple) {
    lines.push(
      'import type { ComponentChildren } from "preact";',
      'import * as v from "valibot";',
      "",
      "const Content = (): ComponentChildren => {",
      "  const { data } = definition.useInstance();",
      "  return data.title;",
      "};"
    );
  } else {
    lines.push("", 'const Content = () => "App content";');
  }
  lines.push(
    "",
    "const definition = defineView({",
    `  slot: ${JSON.stringify(slot)},`,
    `  view: ${JSON.stringify(view)},`,
    "  component: Content,"
  );
  if (multiple) {
    lines.push(
      "  instances: {",
      "    dataSchema: v.object({ title: v.string() }),",
      "    resolve: () => [",
      '      { key: "overview", metadata: {}, data: { title: "Overview" } },',
      "    ],",
      "  },"
    );
  }
  lines.push("});", "", "export default definition;", "```");
  return lines.join("\n");
};
