import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Liquid } from "liquidjs";

import { TEMPLATE_DRIZZLE_VERSION } from "./package-versions";
import {
  rootTemplate,
  defaultViewTemplate,
  gitignoreTemplate,
  viteConfigTemplate,
  packageJsonTemplate,
  tailorkitConfigTemplate,
  tsconfigTemplate,
  serverTemplate,
  schemaTemplate,
  databaseTemplate,
  relationsTemplate,
  greetingTemplate,
  logoDarkTemplate,
  logoLightTemplate,
} from "./templates/index";
import { generateTypes } from "./types";
import type { TailorKitSchemaFile } from "./types";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

export interface GenerateAppOptions {
  targetDirectory: string;
  force: boolean;
  hostUrl: string;
  schema: TailorKitSchemaFile;
  tooling: "vite-plus" | "vite";
  packageName: string;
  packageVersions: {
    drizzleKit?: string;
    drizzleOrm?: string;
    vite: string;
    vitePlus?: string;
    preact: string;
    tailorkit: string;
    typescript: string;
    zod?: string;
  };
  useWorkspaceDependencies?: boolean;
}

const engine = new Liquid({ strictVariables: true });

// eslint-disable-next-line no-control-regex -- Host-provided file names cannot contain control characters.
const invalidFilenameCharacters = /[<>:"/\\|?*#\u0000-\u001F]/u;
const isFilenameSegment = (segment: string) =>
  segment !== "" &&
  segment !== "." &&
  segment !== ".." &&
  !invalidFilenameCharacters.test(segment);

const getViewModulePath = (slotName: string, viewPath: string) => {
  const viewSegments =
    viewPath === "/" ? ["home"] : viewPath.slice(1).split("/");
  const routeName = viewSegments.join(".");
  if (
    !viewPath.startsWith("/") ||
    ![slotName, ...viewSegments, ...routeName.split(".")].every(
      isFilenameSegment
    )
  ) {
    throw new Error(
      "The selected slot and view must have valid file names with no empty dot-separated route segments to generate src/slots."
    );
  }
  return ["slots", slotName, routeName].join("/");
};

const renderTemplate = <TData extends object>(
  template: string,
  data: TData
): Promise<string> => engine.parseAndRender(template, data);

const ensureDirectory = (directory: string): Promise<void> =>
  (async () => {
    void (await mkdir(directory, { recursive: true }));
    /* Intentionally no action is needed. */
  })();

const writeTemplateFile = async (
  filepath: string,
  contents: string,
  force: boolean
): Promise<void> => {
  if (!force && existsSync(filepath)) {
    throw new Error(`${filepath} already exists. Use --force to overwrite it.`);
  }
  await writeFile(filepath, contents, "utf-8");
};

export const generateApp = async (
  options: GenerateAppOptions
): Promise<void> => {
  const {
    targetDirectory,
    force,
    hostUrl,
    schema,
    tooling,
    packageName,
    packageVersions,
    useWorkspaceDependencies,
  } = options;

  const slots = Object.keys(schema.slots ?? {}).toSorted();
  const viewPath = Object.keys(schema.views ?? {})
    .toSorted()
    .find((view) =>
      slots.some((slot) => schema.slots?.[slot]?.views.includes(view))
    );
  if (viewPath === undefined) {
    throw new Error(
      "The host schema has no views supported by a slot. Add a view and slot before running tailorkit init."
    );
  }
  const slotName = requireValue(
    slots.find((slot) => schema.slots?.[slot]?.views.includes(viewPath))
  );
  const viewModulePath = getViewModulePath(slotName, viewPath);
  const viewFile = path.join("src", `${viewModulePath}.view.tsx`);
  const box = schema.components?.Box;
  // Only use a wrapper that accepts children without requiring host-specific props.
  const useBox = box?.children === true && !box.fields?.required?.length;
  const bindingsPath = path.join(targetDirectory, "src", "tailorkit.gen.ts");
  if (!force && existsSync(bindingsPath)) {
    throw new Error(
      `${bindingsPath} already exists. Use --force to overwrite it.`
    );
  }

  const tailorkitVersion = useWorkspaceDependencies
    ? "workspace:*"
    : packageVersions.tailorkit;

  const templateData = {
    drizzleKitVersion: packageVersions.drizzleKit ?? TEMPLATE_DRIZZLE_VERSION,
    drizzleOrmVersion: packageVersions.drizzleOrm ?? TEMPLATE_DRIZZLE_VERSION,
    hostUrl,
    multiple: schema.slots?.[slotName]?.multiple === true,
    packageName,
    preactVersion: packageVersions.preact,
    slotName: JSON.stringify(slotName),
    tailorkitVersion,
    tooling,
    typescriptVersion: packageVersions.typescript,
    useBox,
    viewPath: JSON.stringify(viewPath),
    vitePlus: tooling === "vite-plus",
    vitePlusVersion: packageVersions.vitePlus ?? "1.0.0",
    viteVersion: packageVersions.vite,
    zodVersion: packageVersions.zod ?? "^4.0.0",
  };

  await ensureDirectory(path.dirname(path.join(targetDirectory, viewFile)));
  await ensureDirectory(path.join(targetDirectory, "src", "functions"));
  await ensureDirectory(path.join(targetDirectory, "src", "db", "migrations"));

  const files: { template: string; dest: string; condition?: boolean }[] = [
    { dest: "package.json", template: packageJsonTemplate },
    { dest: "tsconfig.json", template: tsconfigTemplate },
    { dest: "tailorkit.config.ts", template: tailorkitConfigTemplate },
    { dest: "logo-dark.svg", template: logoDarkTemplate },
    { dest: "logo-light.svg", template: logoLightTemplate },
    { dest: ".gitignore", template: gitignoreTemplate },
    { dest: "vite.config.ts", template: viteConfigTemplate },
    { dest: path.join("src", "root.tsx"), template: rootTemplate },
    { dest: viewFile, template: defaultViewTemplate },
    { dest: path.join("src", "server.ts"), template: serverTemplate },
    { dest: path.join("src", "db", "schema.ts"), template: schemaTemplate },
    { dest: path.join("src", "db", "index.ts"), template: databaseTemplate },
    {
      dest: path.join("src", "db", "relations.ts"),
      template: relationsTemplate,
    },
    {
      dest: path.join("src", "functions", "greeting.ts"),
      template: greetingTemplate,
    },
  ];

  await Promise.all(
    files
      .filter((f) => f.condition !== false)
      .map(async ({ template, dest }) => {
        const rendered = await renderTemplate(template, templateData);
        await writeTemplateFile(
          path.join(targetDirectory, dest),
          rendered,
          force
        );
      })
  );

  // Use the same binding generator as `tailorkit generate`, even without installation.
  await generateTypes({ cwd: targetDirectory, schema });
};
