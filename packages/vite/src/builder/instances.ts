import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseSync, transformWithOxc } from "vite";
import type { ESTree, Plugin } from "vite";

import { createDefineViewMatcher } from "./define-view";
import { inferFileView } from "./file-routes";

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

type Node = ESTree.Node;

type Import = ESTree.ImportDeclaration;

type Property = Extract<
  ESTree.ObjectExpression["properties"][number],
  { type: "Property" }
>;

interface Unit {
  node: Node;
  names: string[];
  code: string;
  exported: boolean;
}

interface Resolver {
  name: string;
  view: string;
  call: ESTree.CallExpression;
  instances: Property;
  resolve: Property;
  schema: Property;
}

export interface InstanceModule {
  filename: string;
  names: string[];
}

export interface InstanceRegistration {
  slot: string;
  path: string;
  resolver: string;
}

const suffix = "?patchsmith-instances";

const browserGlobals = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
]);

const isNode = (value: unknown): value is Node =>
  value !== undefined &&
  value !== null &&
  value !== false &&
  value !== "" &&
  value !== 0 &&
  !Number.isNaN(value) &&
  value !== 0n &&
  typeof value === "object" &&
  "type" in value;

const children = (node: Node): Node[] =>
  Object.values(node).flatMap((value) =>
    (() => {
      if (Array.isArray(value)) {
        return value.filter(isNode);
      }

      if (isNode(value)) {
        return [value];
      }

      return [];
    })()
  );

const walk = (
  node: Node,
  visit: (node: Node, ancestors: Node[]) => void,
  ancestors: Node[] = []
) => {
  visit(node, ancestors);

  for (const child of children(node)) {
    walk(child, visit, [...ancestors, node]);
  }
};

const boundNames = (node: Node | null | undefined): string[] => {
  if (!node) {
    return [];
  }

  if (node.type === "Identifier") {
    return [node.name];
  } else if (node.type === "RestElement") {
    return boundNames(node.argument);
  } else if (node.type === "AssignmentPattern") {
    return boundNames(node.left);
  } else if (node.type === "ArrayPattern") {
    return node.elements.flatMap(boundNames);
  } else if (node.type === "ObjectPattern") {
    return node.properties.flatMap((p) =>
      boundNames(p.type === "Property" ? p.value : p.argument)
    );
  }

  return [];
};

const declarations = (node: Node): string[] => {
  if (node.type === "VariableDeclaration") {
    return node.declarations.flatMap((d) => boundNames(d.id));
  }

  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    return boundNames(node.id);
  }

  return [];
};

const isFunction = (node: Node) =>
  [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ].includes(node.type);

/** Lexical references, excluding property names and bindings local to a function/block. */
const freeNames = (root: Node): Set<string> => {
  const references = new Set<string>();

  const pattern = (
    node: Node,
    scope: Set<string>,
    visit: (node: Node, scope: Set<string>) => void
  ) => {
    if (node.type === "AssignmentPattern") {
      visit(node.right, scope);
      pattern(node.left, scope, visit);
    } else if (node.type === "ObjectPattern") {
      for (const p of node.properties) {
        if (p.type === "Property") {
          if (p.computed) {
            visit(p.key, scope);
          }

          pattern(p.value, scope, visit);
        } else {
          pattern(p.argument, scope, visit);
        }
      }
    } else if (node.type === "ArrayPattern") {
      for (const element of node.elements) {
        if (element) {
          pattern(element, scope, visit);
        }
      }
    } else if (node.type === "RestElement") {
      pattern(node.argument, scope, visit);
    }
  };

  // oxlint-disable-next-line complexity -- Keep this existing validation or lifecycle decision tree together; its branches share state and error handling.
  const visit = (node: Node, parent: Set<string>) => {
    if (node.type === "Identifier") {
      if (!parent.has(node.name)) {
        references.add(node.name);
      }

      return;
    }

    if (node.type === "ImportDeclaration") {
      return;
    }

    if (node.type === "ExportSpecifier") {
      visit(node.local, parent);

      return;
    }

    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      const scope = new Set([
        ...parent,
        ...boundNames(node.id),
        ...node.params.flatMap(boundNames),
      ]);

      // var declarations are function-scoped, including those inside nested blocks.
      const hoisted = (body: Node) => {
        if (isFunction(body)) {
          return;
        }

        if (body.type === "VariableDeclaration" && body.kind === "var") {
          for (const name of declarations(body)) {
            scope.add(name);
          }
        }

        for (const child of children(body)) {
          hoisted(child);
        }
      };

      if (node.body) {
        hoisted(node.body);
      }

      for (const p of node.params) {
        pattern(p, scope, visit);
      }

      if (node.body) {
        visit(node.body, scope);
      }

      return;
    }

    if (node.type === "BlockStatement" || node.type === "Program") {
      const scope = new Set([...parent, ...node.body.flatMap(declarations)]);

      for (const statement of node.body) {
        visit(statement, scope);
      }

      return;
    }

    if (node.type === "VariableDeclarator") {
      pattern(node.id, parent, visit);

      if (node.init) {
        visit(node.init, parent);
      }

      return;
    }

    if (
      node.type === "Property" ||
      node.type === "MethodDefinition" ||
      node.type === "PropertyDefinition"
    ) {
      if (node.computed) {
        visit(node.key, parent);
      }

      if (node.value) {
        visit(node.value, parent);
      }

      return;
    }

    if (node.type === "MemberExpression") {
      visit(node.object, parent);

      if (node.computed) {
        visit(node.property, parent);
      }

      return;
    }

    if (node.type === "CatchClause") {
      const scope = new Set([...parent, ...boundNames(node.param)]);

      if (node.param) {
        pattern(node.param, scope, visit);
      }

      visit(node.body, scope);

      return;
    }

    if (
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      const declaration = node.type === "ForStatement" ? node.init : node.left;

      const scope = new Set([
        ...parent,
        ...(declaration ? declarations(declaration) : []),
      ]);

      for (const child of children(node)) {
        visit(child, scope);
      }

      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const scope = new Set([...parent, ...boundNames(node.id)]);

      if (node.superClass) {
        visit(node.superClass, scope);
      }

      visit(node.body, scope);

      return;
    }

    if (node.type === "LabeledStatement") {
      visit(node.body, parent);

      return;
    }

    if (node.type === "BreakStatement" || node.type === "ContinueStatement") {
      return;
    }

    for (const child of children(node)) {
      visit(child, parent);
    }
  };

  visit(root, new Set());

  return references;
};

const property = (
  node: ESTree.ObjectExpression,
  name: string
): Property | undefined =>
  node.properties.find(
    (p): p is Property =>
      p.type === "Property" &&
      !p.computed &&
      (p.key.type === "Identifier"
        ? p.key.name === name
        : p.key.type === "Literal" && p.key.value === name)
  );

const parse = (filename: string, source: string) => {
  const result = parseSync(filename, source);

  if (result.errors.length) {
    throw new Error(
      `Unable to parse ${filename}: ${result.errors[0]?.message}`
    );
  }

  return result.program;
};

const units = (program: ESTree.Program, source: string) => {
  const imports: Import[] = [];
  const statements: Unit[] = [];

  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      imports.push(statement);
      continue;
    }

    const exported =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration";

    const node =
      statement.type === "ExportNamedDeclaration" && statement.declaration
        ? statement.declaration
        : statement;

    if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) {
        statements.push({
          code: `${exported ? "export " : ""}${node.kind} ${source.slice(d.start, d.end)};`,
          exported,
          names: boundNames(d.id),
          node: d,
        });
      }
    } else {
      statements.push({
        code: source.slice(statement.start, statement.end),
        exported,
        names: declarations(node),
        node,
      });
    }
  }

  return { imports, statements };
};

const closure = (roots: Iterable<string>, statements: Unit[]) => {
  const bindings = new Map(
    statements.flatMap((u) => u.names.map((name) => [name, u] as const))
  );

  const names = new Set<string>();
  const selected = new Set<Unit>();

  const add = (name: string) => {
    if (names.has(name)) {
      return;
    }

    names.add(name);
    const unit = bindings.get(name);

    if (!unit || selected.has(unit)) {
      return;
    }

    selected.add(unit);

    for (const ref of freeNames(unit.node)) {
      add(ref);
    }
  };

  for (const root of roots) {
    add(root);
  }

  return { names, selected };
};

const renderImports = (
  imports: Import[],
  needed: (name: string) => boolean,
  source: string,
  sideEffects: boolean
) =>
  imports
    .flatMap((i) => {
      if (!i.specifiers.length) {
        return sideEffects ? [source.slice(i.start, i.end)] : [];
      }

      const parts = i.specifiers.filter((s) => needed(s.local.name));

      if (!parts.length) {
        return [];
      }

      const defaultImport = parts.find(
        (s) => s.type === "ImportDefaultSpecifier"
      );

      const namespace = parts.find(
        (s) => s.type === "ImportNamespaceSpecifier"
      );

      const named = parts.filter(
        (s): s is ESTree.ImportSpecifier => s.type === "ImportSpecifier"
      );

      const clauses = [
        defaultImport?.local.name,
        namespace ? `* as ${namespace.local.name}` : undefined,
        named.length
          ? `{ ${named.map((s) => `${source.slice(s.imported.start, s.imported.end)} as ${s.local.name}`).join(", ")} }`
          : undefined,
      ].filter(Boolean);

      return [
        `import ${clauses.join(", ")} from ${JSON.stringify(i.source.value)};`,
      ];
    })
    .join("\n");

export const extractInstances = async (
  filename: string,
  initialSource: string,
  root: string,
  includedNames?: string[]
): Promise<
  { browser: string; names: string[]; server: string } | undefined
> => {
  let source = initialSource;

  source = inferFileView(source, filename, root);

  const transformed = await transformWithOxc(source, filename, {
    jsx: { importSource: "preact" },
    sourcemap: false,
  });

  source = transformed.code;
  const program = parse(filename.replace(/\.[^.]+$/u, ".js"), source);
  const isDefineViewCall = createDefineViewMatcher(program);
  let resolvers: Resolver[] = [];
  walk(program, (node, ancestors) => {
    if (!isDefineViewCall(node)) {
      return;
    }

    const [options] = node.arguments;

    if (options?.type !== "ObjectExpression") {
      return;
    }

    const instances = property(options, "instances");

    if (!instances) {
      return;
    }

    const fail: (message: string) => never = (message) => {
      throw new Error(`${filename}: ${message}`);
    };

    if (ancestors.some(isFunction)) {
      fail("defineView with instances must be declared at module scope.");
    }

    const owner = ancestors.findLast((n) => n.type === "VariableDeclarator");

    const viewName =
      owner?.type === "VariableDeclarator" && owner.id.type === "Identifier"
        ? owner.id.name
        : "default";

    const view = property(options, "view")?.value;

    if (view?.type !== "Literal" || !isStringValue(view.value)) {
      fail("Instance view paths must be string literals.");
    }

    if (instances.value.type !== "ObjectExpression") {
      fail("instances must be an inline object with dataSchema and resolve.");
    }

    const config = instances.value;

    if (
      config.properties.some(
        (p) => p.type !== "Property" || p.computed || p.kind !== "init"
      )
    ) {
      fail(
        "Instance options cannot contain spreads, getters or computed properties."
      );
    }

    const resolve = property(config, "resolve");
    const schema = property(config, "dataSchema");

    if (
      !resolve ||
      !schema ||
      resolve.method ||
      !["ArrowFunctionExpression", "FunctionExpression"].includes(
        resolve.value.type
      )
    ) {
      fail("instances requires dataSchema and an inline resolve function.");
    }

    const name = `i${createHash("sha256")
      .update(
        `${path.relative(root, filename).split(path.sep).join("/")}\0${viewName}\0${
          view.value
        }`
      )
      .digest("hex")
      .slice(0, 24)}`;

    if (resolvers.some((r) => r.name === name)) {
      fail(
        "Instance resolvers must have distinct module-level variable names."
      );
    }

    resolvers.push({
      call: node,
      instances,
      name,
      resolve: requireValue(resolve),
      schema: requireValue(schema),
      view: view.value,
    });
  });

  if (includedNames) {
    resolvers = resolvers.filter((r) => includedNames.includes(r.name));

    if (resolvers.length !== includedNames.length) {
      throw new Error(
        `${filename}: Instance definitions changed; rebuild the app client.`
      );
    }
  }

  if (!resolvers.length) {
    return undefined;
  }

  const original = units(program, source);

  const server = closure(
    resolvers.flatMap((r) => [
      ...freeNames(r.resolve.value),
      ...freeNames(r.schema.value),
    ]),
    original.statements
  );

  for (const name of server.names) {
    if (browserGlobals.has(name)) {
      throw new Error(
        `${filename}: Instance resolvers cannot access browser global ${name}.`
      );
    }
  }

  for (const unit of server.selected) {
    if (
      resolvers.some(
        (r) => unit.node.start <= r.call.start && unit.node.end >= r.call.end
      )
    ) {
      throw new Error(
        `${filename}: Instance resolvers cannot capture a view definition. Use the supplied context and queries.`
      );
    }
  }

  const serverSource = [
    renderImports(
      original.imports,
      (name) => server.names.has(name),
      source,
      false
    ),
    ...original.statements
      .filter((u) => server.selected.has(u))
      .map((u) => u.code.replace(/^export /u, "")),
    `export const resolvers = { ${resolvers.map((r) => `${r.name}: { dataSchema: ${source.slice(r.schema.value.start, r.schema.value.end)}, resolve: ${source.slice(r.resolve.value.start, r.resolve.value.end)} }`).join(", ")} };`,
  ].join("\n");

  let browserSource = source;

  for (const r of [...resolvers].toSorted(
    (a, b) => b.instances.value.start - a.instances.value.start
  )) {
    browserSource = `${browserSource.slice(
      0,
      r.instances.value.start
    )}{ resolver: ${JSON.stringify(r.name)} }${browserSource.slice(
      r.instances.value.end
    )}`;
  }

  const browser = units(parse("browser.js", browserSource), browserSource);
  const serverBindings = new Set([...server.selected].flatMap((u) => u.names));

  const browserRoots = browser.statements.filter(
    (u) =>
      u.exported ||
      !u.names.length ||
      !u.names.some((name) => serverBindings.has(name))
  );

  const browserNeeded = closure(
    browserRoots.flatMap((u) => [...freeNames(u.node), ...u.names]),
    browser.statements
  );

  return {
    browser: [
      renderImports(
        browser.imports,
        (name) => !server.names.has(name) || browserNeeded.names.has(name),
        browserSource,
        true
      ),
      ...browser.statements
        .filter(
          (u) => browserRoots.includes(u) || browserNeeded.selected.has(u)
        )
        .map((u) => u.code),
    ].join("\n"),
    names: resolvers.map((r) => r.name),
    server: serverSource,
  };
};

export const instanceExtractionPlugin = (
  root: () => string,
  serverConfigured: () => boolean,
  modules: Map<string, InstanceModule>
): Plugin => ({
  enforce: "pre",
  name: "patchsmith-instance-extraction",
  transform: async (
    source,
    filename
  ): Promise<{ code: string; map: null } | undefined> => {
    if (
      filename.includes("node_modules") ||
      !/\.[cm]?[jt]sx?$/u.test(filename) ||
      (!source.includes("instances") && !modules.has(filename))
    ) {
      return undefined;
    }

    const result = await extractInstances(filename, source, root());

    if (!result) {
      modules.delete(filename);

      return undefined;
    }

    if (!serverConfigured()) {
      throw new Error(
        "View instances require server configuration in patchsmith.config.ts."
      );
    }

    modules.set(filename, { filename, names: result.names });

    return { code: result.browser, map: null };
  },
});

export const instanceServerPlugin = (
  root: string,
  modules: InstanceModule[]
): Plugin => ({
  enforce: "pre",
  async load(id): Promise<string | undefined> {
    if (!id.endsWith(suffix)) {
      return undefined;
    }

    const filename = id.slice(0, -suffix.length);
    this.addWatchFile(filename);
    const names = modules.find((module) => module.filename === filename)?.names;

    const result = await extractInstances(
      filename,
      await readFile(filename, "utf-8"),
      root,
      names
    );

    if (!result) {
      throw new Error(
        `Instance resolver missing from ${filename}; rebuild the app client.`
      );
    }

    return result.server;
  },
  name: "patchsmith-instance-server-modules",
  resolveId: (id) => (id.endsWith(suffix) ? id : undefined),
});

export const instanceServerImports = (modules: InstanceModule[]) =>
  modules
    .map(
      (m, i) =>
        `import { resolvers as instances${i} } from ${JSON.stringify(m.filename + suffix)};`
    )
    .join("\n");

export const instanceServerBindings = (
  modules: InstanceModule[],
  registrations: InstanceRegistration[]
) =>
  `[${registrations
    .map(({ slot, path: viewPath, resolver }) => {
      const index = modules.findIndex((module) =>
        module.names.includes(resolver)
      );

      if (index === -1) {
        throw new Error(
          "Instance resolver was not extracted by the app build."
        );
      }

      return `{ slot: ${JSON.stringify(slot)}, path: ${JSON.stringify(viewPath)}, ...instances${index}[${JSON.stringify(resolver)}] }`;
    })
    .join(", ")}]`;
