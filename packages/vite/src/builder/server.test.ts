/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access -- This integration fixture loads workspace or generated modules dynamically and supplies minimal platform doubles; its assertions validate the observed runtime contract. */
import {
  cp,
  readFile,
  writeFile,
  rm,
  readdir,
  mkdtemp,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  TailorKitClientWithMeta,
  ViewDefinition,
  ViewInstance,
} from "@tailorkit/app/client";
import type {
  ApplicationModule,
  FunctionDefinition,
} from "@tailorkit/app/server";
import { Window } from "happy-dom";
import type { VNode } from "preact";
import * as v from "valibot";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { tailorkit } from "#index";
import { linkTestDependencies, createDatabaseTestApp } from "#test-utils";

import { readClientManifest } from "./client-views";
import { runtimeManifest } from "./server";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const buildFixture = async (options: {
  cwd: string;
  configPath?: string;
  outDir?: string;
  watch?: boolean;
}) => {
  const result = await build({
    build: {
      outDir: options.outDir,
      watch: options.watch === true ? {} : null,
    },
    configFile: false,
    plugins: [
      tailorkit({
        configPath: path.resolve(
          options.cwd,
          options.configPath ?? "tailorkit.config.mjs"
        ),
      }),
    ],
    root: options.cwd,
  });
  if ("on" in result) {
    const initialBuild = Promise.withResolvers<ReturnType<() => void>>();
    result.on("event", (event) => {
      if (event.code === "END") {
        initialBuild.resolve();
      }
      if (event.code === "ERROR") {
        initialBuild.reject(event.error);
      }
    });
    await initialBuild.promise;
  }
  return result;
};

declare module "@tailorkit/app/client" {
  interface TailorKitViews {
    "/": { context: { workspaceId: string } };
  }
}

it("builds file routes with a configured server and blocks server imports from the browser", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-custom-entries-"));
  try {
    await linkTestDependencies(root);
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { name: "Test App", slug: "test-app", host: "https://host.example.com", server: { entry: "./backend/api.ts" } };'
    );
    await Promise.all(
      ["src", "backend"].map(async (directory) => {
        await mkdir(path.join(root, directory));
      })
    );
    await writeFile(
      path.join(root, "src/client.ts"),
      'throw new Error("Unused default client");'
    );
    await writeFile(
      path.join(root, "src/server.ts"),
      'throw new Error("Unused default server");'
    );
    const client =
      'import { defineRoute } from "tailorkit/client"; export default defineRoute({ shellComponent: () => "Configured client loaded" });';
    await writeFile(path.join(root, "src/root.tsx"), client);
    await writeFile(
      path.join(root, "backend/api.ts"),
      'import { defineServer, fn } from "tailorkit/server";\nconst app = defineServer({ configured: fn.query.handler(() => "Configured server loaded") });\nexport default app;'
    );
    await writeFile(
      path.join(root, "backend/helper.ts"),
      'export const value = "Lazy server helper";'
    );
    await writeFile(
      path.join(root, "backend/api.ts"),
      'import { defineServer, fn } from "tailorkit/server"; export default defineServer({ configured: fn.query.handler(() => "Configured server loaded"), lazy: fn.action.handler(async () => (await import("./helper")).value) });'
    );
    await buildFixture({ cwd: root });
    expect(await readdir(path.join(root, ".tailorkit/server"))).toEqual([
      "server.js",
    ]);
    expect(await readdir(path.join(root, ".tailorkit/tmp"))).toEqual([]);
    const browser = await readFile(
      path.join(root, ".tailorkit/client/client.js"),
      "utf-8"
    );
    const server = await readFile(
      path.join(root, ".tailorkit/server/server.js"),
      "utf-8"
    );
    expect(browser).toContain("Configured client loaded");
    expect(server).toContain("Configured server loaded");
    expect(server).toContain("Lazy server helper");
    expect(server).not.toContain("./assets/");
    const application: ApplicationModule = await import(
      pathToFileURL(path.join(root, ".tailorkit/server/server.js")).href
    );
    expect(application.runtimeManifest).toEqual(runtimeManifest);
    expect(application.default.functions.configured?.kind).toBe("query");
    expect(application.migrations).toEqual([]);
    expect(browser).not.toContain("Configured server loaded");
    expect(browser).not.toContain("Unused default client");
    expect(server).not.toContain("Unused default server");
    await writeFile(
      path.join(root, "src/root.tsx"),
      `import type app from "../backend/api";\n${client}`
    );
    await expect(buildFixture({ cwd: root })).resolves.toBeDefined();
    await writeFile(
      path.join(root, "src/root.tsx"),
      `import "../backend/api";\n${client}`
    );
    await expect(buildFixture({ cwd: root })).rejects.toThrow(
      "cannot be imported into a browser bundle"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

describe("database app builds", () => {
  let template: string | undefined;

  beforeAll(async () => {
    template = await mkdtemp(
      path.join(tmpdir(), "tailorkit-database-template-")
    );
    await createDatabaseTestApp(template);
  });
  afterAll(async () => {
    if (template !== undefined) {
      await rm(template, { force: true, recursive: true });
    }
  });

  const withDatabaseApp = async (check: (root: string) => Promise<void>) => {
    const source = requireValue(template);
    const root = await mkdtemp(path.join(tmpdir(), "tailorkit-server-build-"));
    try {
      // Generate migrations once, then give each build its own sources and outputs.
      await Promise.all(
        ["package.json", "tailorkit.config.mjs", "src"].map(
          async (filename) => {
            await cp(path.join(source, filename), path.join(root, filename), {
              recursive: true,
            });
          }
        )
      );
      await linkTestDependencies(root);
      await check(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  };

  it("builds separate artifacts without exposing server code to the browser", async () => {
    await withDatabaseApp(async (root) => {
      const sourceFiles = await readdir(path.join(root, "src"), {
        recursive: true,
      });
      await buildFixture({ cwd: root });
      const browser = await readFile(
        path.join(root, ".tailorkit/client/client.js"),
        "utf-8"
      );
      const server = await readFile(
        path.join(root, ".tailorkit/server/server.js"),
        "utf-8"
      );
      // Keep a small app below this budget, including its schemas and ORM.
      expect(Buffer.byteLength(server)).toBeLessThan(150_000);
      expect(server).not.toContain("tailorkit_receipts");
      expect(server).not.toContain("cloudflare:workers");
      expect(server).not.toContain("node:async_hooks");
      expect(server).not.toContain(
        "CREATE TABLE IF NOT EXISTS tailorkit_migrations"
      );
      expect(server).toContain("CREATE TABLE `todos`");
      expect(browser).not.toContain("tailorkit_migrations");
      expect(browser).not.toContain("CREATE TABLE `todos`");
      expect(browser).not.toContain("tailorkit_receipts");
      expect(browser).not.toContain("PRIVATE_DATABASE_TEST");
      expect(browser).not.toContain("cloudflare:workers");
      expect(browser).not.toContain("jwtVerify");
      expect(browser).not.toContain("SignJWT");
      expect(
        await readdir(path.join(root, "src"), { recursive: true })
      ).toEqual(sourceFiles);
      expect(sourceFiles).not.toContain("server.gen.ts");
      expect(
        JSON.parse(
          await readFile(
            path.join(root, ".tailorkit/tailorkit-upload.json"),
            "utf-8"
          )
        ).assets
      ).toEqual({ client: "client/client.js", server: "server/server.js" });
      const migrationFiles = await readdir(
        path.join(root, "src/db/migrations"),
        {
          recursive: true,
        }
      );
      expect(
        await readdir(path.join(root, ".tailorkit/migrations"), {
          recursive: true,
        })
      ).toEqual(migrationFiles);
      await Promise.all(
        migrationFiles
          .filter((filename) => filename.endsWith("migration.sql"))
          .map(async (file) => {
            expect(
              await readFile(
                path.join(root, ".tailorkit/migrations", file),
                "utf-8"
              )
            ).toBe(
              await readFile(
                path.join(root, "src/db/migrations", file),
                "utf-8"
              )
            );
          })
      );
    });
  });

  it("preserves the client bundle and migrations with custom output", async () => {
    await withDatabaseApp(async (root) => {
      await buildFixture({ cwd: root });
      const browser = await readFile(
        path.join(root, ".tailorkit/client/client.js"),
        "utf-8"
      );
      const migrationFiles = await readdir(
        path.join(root, "src/db/migrations"),
        {
          recursive: true,
        }
      );
      await buildFixture({ cwd: root, outDir: ".tailorkit/custom" });
      expect(
        await readFile(
          path.join(root, ".tailorkit/custom/client/client.js"),
          "utf-8"
        )
      ).toBe(browser);
      const customServer = await readFile(
        path.join(root, ".tailorkit/custom/server/server.js"),
        "utf-8"
      );
      expect(customServer).not.toContain(
        "CREATE TABLE IF NOT EXISTS tailorkit_migrations"
      );
      expect(customServer).toContain("CREATE TABLE `todos`");
      expect(
        await readdir(path.join(root, ".tailorkit/custom/migrations"), {
          recursive: true,
        })
      ).toEqual(migrationFiles);
    });
  });

  it.each([
    "./server",
    "tailorkit/server",
    "tailorkit/db",
    "@tailorkit/app-db",
    "effect",
  ])("rejects the browser's accidental import of %s", async (specifier) => {
    await withDatabaseApp(async (root) => {
      const clientPath = path.join(root, "src/root.tsx");
      const client = await readFile(clientPath, "utf-8");
      await writeFile(
        clientPath,
        `import ${JSON.stringify(specifier)};\n${client}`
      );
      await expect(buildFixture({ cwd: root })).rejects.toThrow(
        "cannot be imported into a browser bundle"
      );
    });
  });

  it("rejects build output overlapping the migration source", async () => {
    await withDatabaseApp(async (root) => {
      await expect(
        buildFixture({ cwd: root, outDir: "src/db/migrations" })
      ).rejects.toThrow("must not overlap migration source");
    });
  });
});

it("builds colocated instance resolvers as query-only server actions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-instances-build-"));
  try {
    await linkTestDependencies(root);
    await mkdir(path.join(root, "src/slots/page"), { recursive: true });
    await mkdir(path.join(root, "src/slots/panel.links"), { recursive: true });
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { name: "Test App", slug: "test-app", host: "https://host.example.com", server: {} };'
    );
    await writeFile(
      path.join(root, "src/server.ts"),
      `
      import { defineServer, fn } from "tailorkit/server";
      export default defineServer({ reports: {
        list: fn.query.handler(() => [{ id: "report_123" }]),
        write: fn.mutation.handler(() => "never"),
        external: fn.action.handler(() => Promise.resolve("never")),
      } });
    `
    );
    await writeFile(
      path.join(root, "src/private.ts"),
      'export function title(id: string) { return "PRIVATE_SERVER_ONLY:" + id; }'
    );
    const viewSource = `
      import { defineView } from "tailorkit/client";
      import { z } from "zod";
      import { title } from "../../private";
      const privatePrefix = (() => "PRIVATE_INITIALIZER")();
      const view = defineView({ slot: "page", view: "/",
        instances: {
          dataSchema: z.object({ id: z.string().transform(v => v.toUpperCase()) }),
          resolve: async ({ queries, context, identity, signal, ...other }) => {
            if (Object.keys(other).length) throw new Error("Unexpected resolver capabilities");
            if (Object.keys(queries.reports).join() !== "list") throw new Error("Unexpected query capabilities");
            const reports = await queries.reports.list();
            return reports.map(report => ({ key: report.id, metadata: { title: title(context.userId) + privatePrefix }, data: { id: report.id } }));
          },
        },
        component: () => "BROWSER_COMPONENT_MUST_NOT_RUN:" + view.useInstance().data.id,
      });
      export default view;
    `;
    await writeFile(
      path.join(root, "src/slots/page/index.view.tsx"),
      viewSource
    );
    await writeFile(
      path.join(root, "src/slots/panel.links/index.view.tsx"),
      'import view from "../page/index.view"; export default { ...view, slot: "panel.links" };'
    );
    await buildFixture({ cwd: root });
    const browser = await readFile(
      path.join(root, ".tailorkit/client/client.js"),
      "utf-8"
    );
    const server = await readFile(
      path.join(root, ".tailorkit/server/server.js"),
      "utf-8"
    );
    expect(browser).not.toContain("PRIVATE_SERVER_ONLY");
    expect(browser).not.toContain("PRIVATE_INITIALIZER");
    expect(browser).not.toContain("Unexpected resolver capabilities");
    expect(browser).toContain("BROWSER_COMPONENT_MUST_NOT_RUN");
    expect(server).toContain("PRIVATE_SERVER_ONLY");
    expect(server).not.toContain("BROWSER_COMPONENT_MUST_NOT_RUN");
    const application: ApplicationModule = await import(
      pathToFileURL(path.join(root, ".tailorkit/server/server.js")).href
    );
    // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This controlled fixture supplies only the platform members exercised by the test, or deliberately invalid input for runtime validation.
    const internal = application.default.functions._tailorkit as Record<
      string,
      Record<
        string,
        FunctionDefinition<
          "action",
          v.GenericSchema,
          v.InferOutput<v.GenericSchema>,
          ApplicationModule["default"]["functions"]
        > & { functions: ApplicationModule["default"]["functions"] }
      >
    >;
    const manifest = await readClientManifest(
      path.join(root, ".tailorkit/client/client.js")
    );
    const names = [
      ...new Set(manifest.instanceResolvers.map((entry) => entry.resolver)),
    ];
    expect(names).toHaveLength(1);
    expect(Object.keys(requireValue(internal.instances))).toEqual(["resolve"]);
    expect(manifest.views).toEqual([
      { instances: true, path: "/", slot: "page" },
      { instances: true, path: "/", slot: "panel.links" },
    ]);
    const fn = requireValue(requireValue(internal.instances).resolve);
    expect(fn.kind).toBe("action");
    expect(browser).toContain(requireValue(names[0]));
    expect(Object.keys(requireValue(fn.functions.reports))).toEqual(["list"]);
    // SAFETY: This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input.

    const resolved = await fn.handler(
      /* oxlint-disable typescript/no-unsafe-type-assertion -- This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input. */
      {
        args: v.parse(fn.args, {
          context: { userId: "user_123" },
          path: "/",
          slot: "page",
        }),
        identity: { userId: "user_123" },
        mutations: {},
        queries: {
          reports: { list: vi.fn().mockResolvedValue([{ id: "report_123" }]) },
        },
        signal: new AbortController().signal,
      } as never
      /* oxlint-enable typescript/no-unsafe-type-assertion */
    );
    expect(resolved).toEqual([
      {
        data: { id: "REPORT_123" },
        key: "report_123",
        metadata: { title: "PRIVATE_SERVER_ONLY:user_123PRIVATE_INITIALIZER" },
      },
    ]);
    // SAFETY: This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input.

    const shared = await fn.handler(
      /* oxlint-disable typescript/no-unsafe-type-assertion -- This test deliberately crosses the static type boundary to verify that runtime validation rejects the invalid input. */
      {
        args: v.parse(fn.args, {
          context: { userId: "user_123" },
          path: "/",
          slot: "panel.links",
        }),
        identity: { userId: "user_123" },
        queries: {
          reports: { list: vi.fn().mockResolvedValue([{ id: "report_123" }]) },
        },
        signal: new AbortController().signal,
      } as never
      /* oxlint-enable typescript/no-unsafe-type-assertion */
    );
    expect(shared).toEqual(resolved);
    const window = new Window();
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: window.document,
    });
    try {
      const module = await import(
        `data:text/javascript;base64,${Buffer.from(browser).toString("base64")}`
      );
      // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
      const client =
        /* oxlint-disable typescript/no-unsafe-type-assertion -- The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below. */
        module.default as TailorKitClientWithMeta;
      /* oxlint-enable typescript/no-unsafe-type-assertion */
      // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
      const component = (
        client.slots as Record<string, Record<string, ViewDefinition>>
      ).page?.["/"];
      expect(component).toBeTruthy();
      if (!component) {
        throw new Error("Missing compiled view");
      }
      const container = document.createElement("div");
      // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
      const show = (instance: ViewInstance) => {
        client.$runtime.render(
          /* oxlint-disable typescript/no-unsafe-type-assertion -- The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below. */
          // SAFETY: This fixture controls the asserted value and verifies the runtime boundary below.
          client.$runtime.h(component.component, {
            context: { workspaceId: "w1" },
            instance,
            status: "ready",
            view: "/",
          }) as VNode,
          /* oxlint-enable typescript/no-unsafe-type-assertion */
          container
        );
      };
      const instances = v.parse(
        v.array(
          v.object({
            data: v.unknown(),
            key: v.string(),
            metadata: v.record(v.string(), v.unknown()),
          })
        ),
        resolved
      );
      show(requireValue(instances[0]));
      expect(container.textContent).toBe(
        "BROWSER_COMPONENT_MUST_NOT_RUN:REPORT_123"
      );
      show({ data: { id: "SUMMARY" }, key: "summary", metadata: {} });
      expect(container.textContent).toBe(
        "BROWSER_COMPONENT_MUST_NOT_RUN:SUMMARY"
      );
      // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
      client.$runtime.render(
        /* oxlint-disable typescript/no-unsafe-type-assertion -- The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below. */
        client.$runtime.h(component.component, {
          status: "loading",
          view: "/",
        }) as VNode,
        /* oxlint-enable typescript/no-unsafe-type-assertion */
        container
      );
      expect(container.textContent).toBe("");
      client.$runtime.render(null, container);
    } finally {
      if (previousDocument === undefined) {
        Reflect.deleteProperty(globalThis, "document");
      } else {
        Object.defineProperty(globalThis, "document", {
          configurable: true,
          value: previousDocument,
        });
      }
      await window.happyDOM.close();
    }
    await buildFixture({ cwd: root, outDir: ".tailorkit/custom" });
    expect(
      await readFile(
        path.join(root, ".tailorkit/custom/client/client.js"),
        "utf-8"
      )
    ).toBe(browser);
    const watcher = await buildFixture({
      cwd: root,
      outDir: ".tailorkit/watched",
      watch: true,
    });
    if (!("close" in watcher)) {
      throw new TypeError("Expected a Vite watcher");
    }
    const watchedServer = path.join(
      root,
      ".tailorkit/watched/server/server.js"
    );
    try {
      expect(await readFile(watchedServer, "utf-8")).toContain(
        "PRIVATE_SERVER_ONLY"
      );
      await writeFile(
        path.join(root, "src/private.ts"),
        'export function title(id: string) { return "PRIVATE_UPDATED:" + id; }'
      );
      await expect
        .poll(async () => {
          const awaitedResult1 = await readFile(watchedServer, "utf-8");
          return awaitedResult1.includes("PRIVATE_UPDATED");
        })
        .toBe(true);
      await writeFile(
        path.join(root, "src/slots/page/index.view.tsx"),
        viewSource.replace("PRIVATE_INITIALIZER", "RESOLVER_UPDATED")
      );
      await expect
        .poll(async () => {
          const awaitedResult2 = await readFile(watchedServer, "utf-8").catch(
            () => ""
          );
          return awaitedResult2.includes("RESOLVER_UPDATED");
        })
        .toBe(true);
      // The server watcher can finish while the client watcher is still
      // rebuilding and has temporarily cleared its output directory.
      await expect
        .poll(
          async () =>
            await readFile(
              path.join(root, ".tailorkit/watched/client/client.js"),
              "utf-8"
            ).catch(() => "")
        )
        .toContain(requireValue(names[0]));
      await rm(path.join(root, "src/slots/page/index.view.tsx"));
      await rm(path.join(root, "src/slots/panel.links/index.view.tsx"));
      await expect
        .poll(async () => {
          const output = await readFile(watchedServer, "utf-8").catch(() => "");
          return !!output && !output.includes("RESOLVER_UPDATED");
        })
        .toBe(true);
      const withoutInstances: ApplicationModule = await import(
        `${pathToFileURL(watchedServer).href}?instances-removed`
      );
      expect(
        Object.hasOwn(withoutInstances.default.functions, "_tailorkit")
      ).toBe(false);
    } finally {
      await watcher.close();
    }
    await writeFile(
      path.join(root, "src/slots/page/index.view.tsx"),
      viewSource
    );
    await writeFile(
      path.join(root, "no-server.config.mjs"),
      'export default { name: "Test App", slug: "test-app", host: "https://host.example.com" };'
    );
    await expect(
      buildFixture({ configPath: "no-server.config.mjs", cwd: root })
    ).rejects.toThrow("require server configuration");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
