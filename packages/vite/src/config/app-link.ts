// oxlint-disable-next-line complexity -- Resolve the supported exported config forms before updating the app identity.
export const setConfigAppId = async (
  source: string,
  appId: string,
  configPath: string
): Promise<string> => {
  // The host links sandbox source as data; Vite's native parser is build tooling.
  const { parse } = await import("@babel/parser");
  const { program } = parse(source, {
    plugins: ["typescript"],
    sourceFilename: configPath,
    sourceType: "module",
  });
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
    ["defineTailorKitConfig", "defineConfig"].includes(initializer.callee.name)
  ) {
    const [argument] = initializer.arguments;
    initializer =
      argument?.type === "SpreadElement" ||
      argument?.type === "ArgumentPlaceholder"
        ? undefined
        : argument;
  }
  if (
    initializer?.type !== "ObjectExpression" ||
    initializer.start === null ||
    initializer.start === undefined
  ) {
    throw new Error(
      `Could not write appId to ${configPath}. Add appId: ${JSON.stringify(appId)} manually.`
    );
  }

  const property = initializer.properties.find(
    (node) =>
      node.type === "ObjectProperty" &&
      !node.computed &&
      ((node.key.type === "Identifier" && node.key.name === "appId") ||
        (node.key.type === "StringLiteral" && node.key.value === "appId"))
  );
  if (
    property?.type === "ObjectProperty" &&
    property.start !== null &&
    property.start !== undefined &&
    property.end !== null &&
    property.end !== undefined
  ) {
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
