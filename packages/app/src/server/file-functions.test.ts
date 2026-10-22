import { describe, expect, it } from "vite-plus/test";

import { createApi } from "#client/reference";

import { fn } from "./builder";
import { createFileServer } from "./file-functions";
import { defineRouter } from "./functions";

const children = fn.query.handler(() => ["child"]);
const parents = fn.query.handler(() => ["parent"]);

describe("file function registration", () => {
  it("merges file namespaces and nested router objects without mutating routers", () => {
    const family = defineRouter({ get: { children } });

    const app = createFileServer([
      { filename: "family.fn.ts", functions: family, path: ["family"] },
      {
        filename: "family/get.fn.ts",
        functions: defineRouter({ parents }),
        path: ["family", "get"],
      },
    ]);

    expect(app.functions).toEqual({ family: { get: { children, parents } } });
    expect(family.get).toEqual({ children });

    const api = createApi<{
      family: { get: { children: typeof children; parents: typeof parents } };
    }>();

    expect(api.family.get.children.name).toBe("family.get.children");
    expect(api.family.get.parents.name).toBe("family.get.parents");
  });

  it.each([false, true])(
    "rejects duplicate callables with both source files (reverse: %s)",
    (reverse) => {
      const modules: Parameters<typeof createFileServer>[0] = [
        {
          filename: "family.fn.ts",
          functions: { get: { children } },
          path: ["family"],
        },
        {
          filename: "family/get.fn.ts",
          functions: { children },
          path: ["family", "get"],
        },
      ];

      const register = () =>
        createFileServer(reverse ? modules.toReversed() : modules);

      expect(register).toThrow("Duplicate function: api.family.get.children");
      expect(register).toThrow("family.fn.ts");
      expect(register).toThrow("family/get.fn.ts");
    }
  );

  it.each([false, true])(
    "rejects function/namespace collisions (reverse: %s)",
    (reverse) => {
      const modules: Parameters<typeof createFileServer>[0] = [
        {
          filename: "family.fn.ts",
          functions: { get: children },
          path: ["family"],
        },
        {
          filename: "family/get.fn.ts",
          functions: { parents },
          path: ["family", "get"],
        },
      ];

      expect(() =>
        createFileServer(reverse ? modules.toReversed() : modules)
      ).toThrow("Function/namespace conflict: api.family.get");
    }
  );

  it("supports empty backends", () => {
    expect(createFileServer([]).functions).toEqual({});
  });
});

it.each(["name", "then"])(
  "rejects reserved segment %s at every registration boundary",
  (name) => {
    expect(() => defineRouter({ [name]: children })).toThrow(
      "Reserved function name"
    );
    expect(() => defineRouter({ todos: { [name]: children } })).toThrow(
      "Reserved function name"
    );
    expect(() => defineRouter({ [name]: { list: children } })).toThrow(
      "Reserved function name"
    );
    expect(() =>
      createFileServer([
        { filename: `${name}.fn.ts`, functions: { children }, path: [name] },
      ])
    ).toThrow("Reserved function name");
  }
);
