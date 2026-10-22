import type { ESTree } from "vite";

const clientImports = new Set([
  "patchsmith/client",
  "patchsmith/app",
  "patchsmith/app/client",
  "@patchsmith/app/client",
  "@patchsmith/app",
]);

type Binding = "view" | "namespace" | "local";

interface Scope {
  parent?: Scope;
  functionScope: boolean;
  bindings: Map<string, Binding>;
}

type FunctionNode = ESTree.Function | ESTree.ArrowFunctionExpression;

type ClassNode = Extract<
  ESTree.Node,
  { type: "ClassDeclaration" | "ClassExpression" }
>;

const createScope = (parent?: Scope, functionScope = false): Scope => ({
  bindings: new Map(),
  functionScope,
  parent,
});

const bindingNames = (node: ESTree.Node | null | undefined): string[] => {
  if (!node) {
    return [];
  }

  if (node.type === "Identifier") {
    return [node.name];
  } else if (node.type === "RestElement") {
    return bindingNames(node.argument);
  } else if (node.type === "AssignmentPattern") {
    return bindingNames(node.left);
  } else if (node.type === "ArrayPattern") {
    return node.elements.flatMap(bindingNames);
  } else if (node.type === "ObjectPattern") {
    return node.properties.flatMap((property) =>
      bindingNames(
        property.type === "Property" ? property.value : property.argument
      )
    );
  } else if (node.type === "TSParameterProperty") {
    return bindingNames(node.parameter);
  }

  return [];
};

const bind = (node: ESTree.Node | null | undefined, scope: Scope) => {
  for (const name of bindingNames(node)) {
    scope.bindings.set(name, "local");
  }
};

const classScope = (node: ClassNode, parent: Scope) => {
  if (node.type === "ClassDeclaration") {
    bind(node.id, parent);
  }

  const scope = createScope(parent);
  bind(node.id, scope);

  return scope;
};

const resolve = (
  scope: Scope | undefined,
  name: string
): Binding | undefined => {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) {
      return current.bindings.get(name);
    }
  }

  return undefined;
};

export const childNodes = (node: ESTree.Node): ESTree.Node[] =>
  Object.values(node).flatMap((value) => {
    const children = Array.isArray(value) ? value : [value];

    return children.filter(
      (child): child is ESTree.Node =>
        child !== undefined &&
        child !== null &&
        child !== false &&
        child !== "" &&
        child !== 0 &&
        !Number.isNaN(child) &&
        child !== 0n &&
        typeof child === "object" &&
        "type" in child
    );
  });

const bindImports = (
  node: ESTree.ImportDeclaration,
  scope: Scope,
  imports: Set<string>,
  definition: string
) => {
  const sdk = node.importKind !== "type" && imports.has(node.source.value);

  for (const specifier of node.specifiers) {
    let binding: Binding = "local";

    if (sdk && specifier.type === "ImportNamespaceSpecifier") {
      binding = "namespace";
    } else if (
      sdk &&
      specifier.type === "ImportSpecifier" &&
      specifier.importKind !== "type" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === definition
    ) {
      binding = "view";
    }

    scope.bindings.set(specifier.local.name, binding);
  }
};

/** Resolve SDK import bindings, including declarations hoisted past a call. */
const callScopes = (
  program: ESTree.Program,
  imports: Set<string>,
  definition: string
) => {
  const scopes = new WeakMap<ESTree.Node, Scope>();

  const bindVariables = (node: ESTree.VariableDeclaration, scope: Scope) => {
    let target = scope;

    if (node.kind === "var") {
      while (!target.functionScope && target.parent) {
        target = target.parent;
      }
    }

    for (const declaration of node.declarations) {
      bind(declaration.id, target);
    }
  };

  const visitFunction = (
    node: FunctionNode,
    scope: Scope,
    visit: (node: ESTree.Node, scope: Scope) => void
  ) => {
    if (node.type === "FunctionDeclaration") {
      bind(node.id, scope);
    }

    const parameters = createScope(scope, true);

    if (node.type !== "ArrowFunctionExpression") {
      bind(node.id, parameters);
    }

    for (const parameter of node.params) {
      bind(parameter, parameters);
    }

    for (const parameter of node.params) {
      visit(parameter, parameters);
    }

    // Body declarations do not shadow references in parameter defaults.
    if (node.body) {
      visit(node.body, createScope(parameters, true));
    }
  };

  const visit = (node: ESTree.Node, initialScope: Scope) => {
    let scope = initialScope;

    scopes.set(node, scope);

    if (node.type === "ImportDeclaration") {
      bindImports(node, scope, imports, definition);

      return;
    } else if (node.type === "VariableDeclaration") {
      bindVariables(node, scope);
    } else if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      visitFunction(node, scope, visit);

      return;
    } else if (
      node.type === "ClassDeclaration" ||
      node.type === "ClassExpression"
    ) {
      scope = classScope(node, scope);
    } else if (node.type === "CatchClause") {
      scope = createScope(scope);
      bind(node.param, scope);
    } else if (node.type === "SwitchStatement") {
      visit(node.discriminant, scope);
      scope = createScope(scope);

      for (const branch of node.cases) {
        visit(branch, scope);
      }

      return;
    } else if (
      node.type === "BlockStatement" ||
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement"
    ) {
      scope = createScope(scope);
    } else if (node.type === "StaticBlock" || node.type === "TSModuleBlock") {
      scope = createScope(scope, true);
    } else if (
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration"
    ) {
      bind(node.id, scope);
    }

    for (const child of childNodes(node)) {
      visit(child, scope);
    }
  };

  visit(program, createScope(undefined, true));

  return scopes;
};

/** Recognize the same SDK calls in route inference and instance extraction. */
const createDefinitionMatcher = (
  program: ESTree.Program,
  imports: Set<string>,
  definition: string
) => {
  const scopes = callScopes(program, imports, definition);

  return (node: ESTree.Node): node is ESTree.CallExpression => {
    if (node.type !== "CallExpression") {
      return false;
    }

    const { callee } = node;
    const scope = scopes.get(node);

    if (callee.type === "Identifier") {
      return resolve(scope, callee.name) === "view";
    }

    if (
      callee.type !== "MemberExpression" ||
      callee.object.type !== "Identifier" ||
      resolve(scope, callee.object.name) !== "namespace"
    ) {
      return false;
    }

    return callee.computed
      ? callee.property.type === "Literal" &&
          callee.property.value === definition
      : callee.property.type === "Identifier" &&
          callee.property.name === definition;
  };
};

export const createDefineViewMatcher = (program: ESTree.Program) =>
  createDefinitionMatcher(program, clientImports, "defineView");

const serverImports = new Set([
  "patchsmith/server",
  "@patchsmith/app/server",
  "patchsmith/app/server",
]);

export const createDefineHookMatcher = (program: ESTree.Program) =>
  createDefinitionMatcher(program, serverImports, "defineHook");
