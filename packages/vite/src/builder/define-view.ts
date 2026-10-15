import type { ESTree } from "vite";

const clientImports = new Set([
  "tailorkit/client",
  "tailorkit/app",
  "tailorkit/app/client",
  "@tailorkit/app/client",
  "@tailorkit/app",
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
  /* oxlint-disable typescript/switch-exhaustiveness-check -- This syntax visitor handles selected node kinds; other kinds use its generic traversal or default branch. */
  switch (node.type) {
    case "Identifier": {
      return [node.name];
    }
    case "RestElement": {
      return bindingNames(node.argument);
    }
    case "AssignmentPattern": {
      return bindingNames(node.left);
    }
    case "ArrayPattern": {
      return node.elements.flatMap(bindingNames);
    }
    case "ObjectPattern": {
      return node.properties.flatMap((property) =>
        bindingNames(
          property.type === "Property" ? property.value : property.argument
        )
      );
    }
    case "TSParameterProperty": {
      return bindingNames(node.parameter);
    }
    default: {
      return [];
    }
  }
  /* oxlint-enable typescript/switch-exhaustiveness-check */
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

const bindImports = (node: ESTree.ImportDeclaration, scope: Scope) => {
  const sdk =
    node.importKind !== "type" && clientImports.has(node.source.value);
  for (const specifier of node.specifiers) {
    let binding: Binding = "local";
    if (sdk && specifier.type === "ImportNamespaceSpecifier") {
      binding = "namespace";
    } else if (
      sdk &&
      specifier.type === "ImportSpecifier" &&
      specifier.importKind !== "type" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === "defineView"
    ) {
      binding = "view";
    }
    scope.bindings.set(specifier.local.name, binding);
  }
};

/** Resolve SDK import bindings, including declarations hoisted past a call. */
const callScopes = (program: ESTree.Program) => {
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
    /* oxlint-disable typescript/switch-exhaustiveness-check -- This syntax visitor handles selected node kinds; other kinds use its generic traversal or default branch. */
    switch (node.type) {
      case "ImportDeclaration": {
        bindImports(node, scope);
        return;
      }
      case "VariableDeclaration": {
        bindVariables(node, scope);
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        visitFunction(node, scope, visit);
        return;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        scope = classScope(node, scope);
        break;
      }
      case "CatchClause": {
        scope = createScope(scope);
        bind(node.param, scope);
        break;
      }
      case "SwitchStatement": {
        visit(node.discriminant, scope);
        scope = createScope(scope);
        for (const branch of node.cases) {
          visit(branch, scope);
        }
        return;
      }
      case "BlockStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        scope = createScope(scope);
        break;
      }
      case "StaticBlock":
      case "TSModuleBlock": {
        scope = createScope(scope, true);
        break;
      }
      case "TSEnumDeclaration":
      case "TSModuleDeclaration": {
        bind(node.id, scope);
        break;
      }
      default: {
        break;
      }
    }
    /* oxlint-enable typescript/switch-exhaustiveness-check */
    for (const child of childNodes(node)) {
      visit(child, scope);
    }
  };

  visit(program, createScope(undefined, true));

  return scopes;
};

/** Recognize the same SDK calls in route inference and instance extraction. */
export const createDefineViewMatcher = (program: ESTree.Program) => {
  const scopes = callScopes(program);
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
          callee.property.value === "defineView"
      : callee.property.type === "Identifier" &&
          callee.property.name === "defineView";
  };
};
