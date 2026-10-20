// oxlint-disable-next-line complexity -- Resolve the supported exported config forms before updating the app identity.
export const setConfigAppId = async (
  source: string,
  appId: string,
  configPath: string
): Promise<string> => {
  const { parseSync } = await import("vite");
  const { program } = parseSync(configPath, source);
  const defaultExport = program.body.find(
    (node) => node.type === "ExportDefaultDeclaration"
  );
  let initializer = defaultExport?.declaration;
  if (initializer?.type === "Identifier") {
    const exportedVariable = initializer.name;
    initializer =
      program.body
        .filter((node) => node.type === "VariableDeclaration")
        .flatMap((node) => node.declarations)
        .find(
          (node) =>
            node.id.type === "Identifier" && node.id.name === exportedVariable
        )?.init ?? undefined;
  }
  while (
    initializer?.type === "TSSatisfiesExpression" ||
    initializer?.type === "TSAsExpression"
  ) {
    initializer = initializer.expression;
  }
  if (
    initializer?.type === "CallExpression" &&
    initializer.callee.type === "Identifier" &&
    ["definePatchsmithConfig", "defineConfig"].includes(initializer.callee.name)
  ) {
    const [argument] = initializer.arguments;
    initializer = argument?.type === "SpreadElement" ? undefined : argument;
  }
  if (initializer?.type !== "ObjectExpression") {
    throw new Error(
      `Could not write appId to ${configPath}. Add appId: ${JSON.stringify(appId)} manually.`
    );
  }

  const property = initializer.properties.find(
    (node) =>
      node.type === "Property" &&
      !node.computed &&
      ((node.key.type === "Identifier" && node.key.name === "appId") ||
        (node.key.type === "Literal" && node.key.value === "appId"))
  );
  if (property?.type === "Property") {
    return `${source.slice(0, property.start)}appId: ${JSON.stringify(appId)}${source.slice(property.end)}`;
  }

  const position = initializer.start + 1;
  const rest = source.slice(position);
  const newline = /^(?<newline>\r?\n)(?<indent>[ \t]*)/u.exec(rest);
  const appIdLine = newline
    ? `${newline[1]}${newline[2] ?? "  "}appId: ${JSON.stringify(appId)},`
    : ` appId: ${JSON.stringify(appId)},`;
  return source.slice(0, position) + appIdLine + rest;
};
