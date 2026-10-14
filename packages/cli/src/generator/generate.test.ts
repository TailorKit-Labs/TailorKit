/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access -- Vitest mock call records and asymmetric matchers intentionally erase types; this fixture uses partial doubles and checks their values in assertions. */
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { generateApp } from "./generate";
import type { TailorKitSchemaFile } from "./types";

const testDirectories: string[] = [];

const createTempDir = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "tailorkit-generator-"));
  testDirectories.push(directory);
  return directory;
};

const defaultOptions = {
  force: false,
  hostUrl: "https://host.example.com/api/tailorkit",
  packageName: "test-app",
  packageVersions: {
    preact: "11.0.0",
    tailorkit: "4.5.6",
    typescript: "5.1.0",
    vite: "8.0.0",
    vitePlus: "1.0.0",
  },
  schema: {
    components: {
      Box: {
        callbacks: {},
        children: true,
        fields: { properties: {}, type: "object" },
      },
    },
    slots: { sidebar: { views: ["/customers"] } },
    views: {
      "/customers": {
        context: {
          properties: { customer: { type: "string" } },
          type: "object",
        },
      },
    },
  },
  tooling: "vite",
  useWorkspaceDependencies: false,
} as const;

afterEach(async () => {
  for (const directory of testDirectories.splice(0)) {
    // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
    await rm(directory, { force: true, recursive: true });
  }
});

describe("generateApp", () => {
  it("generates all expected files", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const files = [
      "package.json",
      "tsconfig.json",
      "tailorkit.config.ts",
      "vite.config.ts",
      "logo-dark.svg",
      "logo-light.svg",
      ".gitignore",
      path.join("src", "root.tsx"),
      path.join("src", "slots", "sidebar", "customers.view.tsx"),
      path.join("src", "tailorkit.gen.ts"),
      path.join("src", "server.ts"),
      path.join("src", "db", "schema.ts"),
      path.join("src", "db", "index.ts"),
      path.join("src", "db", "relations.ts"),
      path.join("src", "functions", "greeting.ts"),
    ];

    for (const file of files) {
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      await expect(
        readFile(path.join(targetDirectory, file), "utf-8")
      ).resolves.toBeDefined();
    }
  });

  it("wires the database and relations without a duplicate schema import", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });
    const database = await readFile(
      path.join(targetDirectory, "src/db/index.ts"),
      "utf-8"
    );
    expect(database).toContain("defineDatabase({ relations })");
    expect(database).toContain('export * from "./schema"');
    expect(database).not.toContain("import * as schema");
    expect(
      await readFile(path.join(targetDirectory, "src/db/relations.ts"), "utf-8")
    ).toContain("defineRelations(schema)");
    expect(
      await readFile(
        path.join(targetDirectory, "src/functions/greeting.ts"),
        "utf-8"
      )
    ).toContain(".database(db)");
    expect(
      await readdir(path.join(targetDirectory, "src/db/migrations"))
    ).toEqual([]);
    await expect(
      readFile(path.join(targetDirectory, "src/schema.ts"))
    ).rejects.toThrow();
  });

  it.each(["vite", "vite-plus"] as const)(
    "generates a %s build configuration",
    async (tooling) => {
      const targetDirectory = await createTempDir();
      await generateApp({ ...defaultOptions, targetDirectory, tooling });
      const config = await readFile(
        path.join(targetDirectory, "vite.config.ts"),
        "utf-8"
      );
      const pkg = JSON.parse(
        await readFile(path.join(targetDirectory, "package.json"), "utf-8")
      );
      expect(config).toContain(`from "${tooling}"`);
      expect(config).toContain('from "tailorkit/vite"');
      expect(pkg.devDependencies).not.toHaveProperty("oxlint");
      expect(pkg.devDependencies).not.toHaveProperty("oxfmt");
      expect(pkg.scripts.build).toBe(
        tooling === "vite" ? "vite build" : "vp build"
      );
      if (tooling === "vite-plus") {
        expect(config).toContain("lazyPlugins(() => [tailorkit()])");
        expect(config).toContain("lint:");
        expect(config).toContain("fmt:");
        expect(config).toContain("src/tailorkit.gen.ts");
        expect(pkg.devDependencies["vite-plus"]).toBe("1.0.0");
        expect(pkg.devDependencies.vite).toBe(
          "npm:@voidzero-dev/vite-plus-core@1.0.0"
        );
        expect(pkg.scripts.check).toBe("vp check");
        expect(pkg.scripts.fix).toBe("vp check --fix");
      } else {
        expect(config).not.toContain("lint:");
        expect(config).not.toContain("fmt:");
        expect(pkg.devDependencies.vite).toBe("8.0.0");
        expect(pkg.devDependencies).not.toHaveProperty("vite-plus");
        expect(pkg.scripts).not.toHaveProperty("check");
        expect(pkg.scripts).not.toHaveProperty("format");
        expect(pkg.scripts).not.toHaveProperty("test");
      }
      await expect(
        readFile(path.join(targetDirectory, "oxlint.config.ts"))
      ).rejects.toThrow();
      await expect(
        readFile(path.join(targetDirectory, "oxfmt.config.ts"))
      ).rejects.toThrow();
    }
  );

  it("throws when a file exists and force is false", async () => {
    const targetDirectory = await createTempDir();
    await writeFile(path.join(targetDirectory, "package.json"), "{}", "utf-8");

    await expect(
      generateApp({ ...defaultOptions, targetDirectory })
    ).rejects.toThrow("already exists. Use --force to overwrite it.");
  });

  it("overwrites existing files when force is true", async () => {
    const targetDirectory = await createTempDir();
    await writeFile(path.join(targetDirectory, "package.json"), "{}", "utf-8");

    await expect(
      generateApp({ ...defaultOptions, force: true, targetDirectory })
    ).resolves.toBeUndefined();

    const content = await readFile(
      path.join(targetDirectory, "package.json"),
      "utf-8"
    );
    expect(content).toContain("test-app");
  });

  it("uses workspace dependency version when useWorkspaceDependencies is true", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      targetDirectory,
      useWorkspaceDependencies: true,
    });

    const content = await readFile(
      path.join(targetDirectory, "package.json"),
      "utf-8"
    );
    expect(content).toContain('"tailorkit": "workspace:*"');
    expect(content).not.toContain("@tailorkit/cli");
  });

  it("uses resolved dependency versions when useWorkspaceDependencies is false", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      targetDirectory,
      useWorkspaceDependencies: false,
    });

    const content = await readFile(
      path.join(targetDirectory, "package.json"),
      "utf-8"
    );
    expect(content).toContain('"tailorkit": "4.5.6"');
    expect(content).not.toContain("@tailorkit/cli");
  });

  it("renders package versions into package.json", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(
      path.join(targetDirectory, "package.json"),
      "utf-8"
    );
    expect(content).toContain('"preact": "11.0.0"');
    expect(content).toContain('"typescript": "5.1.0"');
  });

  it("renders the package name into package.json", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      packageName: "my-custom-app",
      targetDirectory,
    });

    const content = await readFile(
      path.join(targetDirectory, "package.json"),
      "utf-8"
    );
    expect(content).toContain('"name": "my-custom-app"');
  });

  it("generates a valid tailorkit.config.ts", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(
      path.join(targetDirectory, "tailorkit.config.ts"),
      "utf-8"
    );
    expect(content).toContain(
      'import type { TailorKitConfig } from "tailorkit/app/config"'
    );
    expect(content).toContain("satisfies TailorKitConfig");
    expect(content).toContain('host: "https://host.example.com/api/tailorkit"');
    expect(content).toContain('dark: "logo-dark.svg"');
    expect(content).toContain('light: "logo-light.svg"');
    expect(content).not.toContain("defineTailorKitConfig");
  });

  it("generates TailorKit logos for both themes", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    for (const variant of ["dark", "light"]) {
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      const content = await readFile(
        path.join(targetDirectory, `logo-${variant}.svg`),
        "utf-8"
      );
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      const brandMark = await readFile(
        new URL(
          `../../../../apps/web/public/brand/mark-${variant}.svg`,
          import.meta.url
        ),
        "utf-8"
      );
      expect(content).toBe(brandMark);
    }
  });

  it("protects existing logos unless force is enabled", async () => {
    for (const variant of ["dark", "light"]) {
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      const targetDirectory = await createTempDir();
      const logoPath = path.join(targetDirectory, `logo-${variant}.svg`);
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      await writeFile(logoPath, "custom logo", "utf-8");

      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      await expect(
        generateApp({ ...defaultOptions, targetDirectory })
      ).rejects.toThrow("already exists. Use --force to overwrite it.");
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      expect(await readFile(logoPath, "utf-8")).toBe("custom logo");

      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      await generateApp({ ...defaultOptions, force: true, targetDirectory });
      // oxlint-disable-next-line no-await-in-loop -- Test steps share fixtures and must complete in order.
      expect(await readFile(logoPath, "utf-8")).toContain("<svg");
    }
  });

  it("generates a default view for the host schema", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(
      path.join(
        targetDirectory,
        "src",
        "slots",
        "sidebar",
        "customers.view.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("defineView({");
    expect(content).toContain('view: "/customers"');
    expect(content).not.toContain("slot:");
    expect(content).not.toContain("instances:");
    expect(content).not.toContain("context.user");
    expect(content).toContain("<Box>");
  });

  it.each([
    { file: "src/slots/panel/index.view.tsx", slot: "panel", view: "/" },
    {
      file: "src/slots/panel/members.view.tsx",
      slot: "panel",
      view: "/members",
    },
    {
      file: "src/slots/panel/members.index.index.view.tsx",
      slot: "panel",
      view: "/members/index",
    },
    {
      file: "src/slots/panel.links/customers.details.view.tsx",
      slot: "panel.links",
      view: "/customers/details",
    },
  ])(
    "uses the slot and dotted route for the view file: %j",
    async ({ slot, view, file }) => {
      const targetDirectory = await createTempDir();
      await generateApp({
        ...defaultOptions,
        schema: { slots: { [slot]: { views: [view] } }, views: { [view]: {} } },
        targetDirectory,
      });
      const root = await readFile(
        path.join(targetDirectory, "src/root.tsx"),
        "utf-8"
      );
      expect(root).toContain("defineRoute({ shellComponent: Shell })");
      const content = await readFile(path.join(targetDirectory, file), "utf-8");
      expect(content).not.toContain("slot:");
      expect(content).toContain(`view: ${JSON.stringify(view)}`);
      await expect(
        readdir(path.join(targetDirectory, "src/views"))
      ).rejects.toThrow();
      await expect(
        readFile(path.join(targetDirectory, "src/client.ts"))
      ).rejects.toThrow();
    }
  );

  it.each([
    { slot: "../db", view: "/customers" },
    { slot: "panel", view: "/../db" },
    { slot: "panel", view: "/customers//details" },
    { slot: "panel", view: "customers" },
    { slot: "panel", view: "/.well-known" },
    { slot: "panel", view: "/customers/.details" },
    { slot: "panel", view: "/customers..details" },
    { slot: "panel", view: "/customers.details" },
    { slot: "panel", view: "/customers." },
  ])(
    "rejects invalid view file paths before writing files: %j",
    async ({ slot, view }) => {
      const targetDirectory = await createTempDir();
      await expect(
        generateApp({
          ...defaultOptions,
          schema: {
            slots: { [slot]: { views: [view] } },
            views: { [view]: {} },
          },
          targetDirectory,
        })
      ).rejects.toThrow("valid file names");
      await expect(
        readFile(path.join(targetDirectory, "package.json"))
      ).rejects.toThrow();
    }
  );

  it("generates an instance resolver for a multi-instance slot", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      schema: {
        ...defaultOptions.schema,
        slots: { sidebar: { multiple: true, views: ["/customers"] } },
      },
      targetDirectory,
    });
    const view = await readFile(
      path.join(targetDirectory, "src/slots/sidebar/customers.view.tsx"),
      "utf-8"
    );
    expect(view).not.toContain("slot:");
    expect(view).toContain('import { z } from "zod"');
    expect(view).toContain("dataSchema: z.object({})");
    expect(view).toContain('key: "default"');
    const types = await readFile(
      path.join(targetDirectory, "src/tailorkit.gen.ts"),
      "utf-8"
    );
    expect(types).toContain(
      '"sidebar": { views: "/customers"; multiple: true }'
    );
  });

  it("generates a root shell with the backend provider", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });
    const content = await readFile(
      path.join(targetDirectory, "src/root.tsx"),
      "utf-8"
    );
    expect(content).toContain(
      'import { ClientProvider, defineRoute, Route } from "tailorkit/client"'
    );
    expect(content).toContain("shellComponent: Shell");
    expect(content).toContain("<ClientProvider><Route /></ClientProvider>");
    expect(content).not.toContain("defineClient");
    expect(content).not.toContain("import defaultView");
  });

  it("does not generate fallback view props for the host schema", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(
      path.join(targetDirectory, "src", "tailorkit.gen.ts"),
      "utf-8"
    );
    expect(content).not.toContain("FallbackViewProps");
    expect(content).not.toContain("DefaultViewProps");
  });

  it("generates a valid generated types file", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(
      path.join(targetDirectory, "src", "tailorkit.gen.ts"),
      "utf-8"
    );
    expect(content).toContain(
      'import { createRemoteComponent } from "tailorkit/client"'
    );
    expect(content).toContain('import { createApi } from "tailorkit/client"');
    expect(content).toContain('import type app from "./server"');
    expect(content).toContain(
      "export const api = createApi<typeof app.functions>();"
    );
    expect(content).toContain('"/customers": {');
    expect(content).toContain("customer?: string;");
    expect(content).toContain("export const Box");
    expect(content).not.toContain("export const Card");
  });

  it("generates a valid tsconfig.json", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({ ...defaultOptions, targetDirectory });

    const content = await readFile(
      path.join(targetDirectory, "tsconfig.json"),
      "utf-8"
    );
    const tsconfig = JSON.parse(content);
    expect(tsconfig.compilerOptions.jsx).toBe("react-jsx");
    expect(tsconfig.compilerOptions.jsxImportSource).toBe("preact");
  });

  it("selects the first supported view and slot alphabetically", async () => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      schema: {
        slots: {
          alpha: { views: ["/accounts"] },
          zebra: { views: ["/zebra", "/accounts"] },
        },
        views: { "/aardvark": {}, "/accounts": {}, "/zebra": {} },
      },
      targetDirectory,
    });
    const client = await readFile(
      path.join(targetDirectory, "src/root.tsx"),
      "utf-8"
    );
    const view = await readFile(
      path.join(targetDirectory, "src/slots/alpha/accounts.view.tsx"),
      "utf-8"
    );
    expect(client).toContain("shellComponent: Shell");
    expect(view).toContain("defineView({");
    expect(view).toContain('view: "/accounts"');
    expect(view).toContain("return <>");
    expect(view).not.toContain("Box");
    expect(view).not.toContain("useContext");
  });

  it.each([
    { callbacks: {}, children: false },
    {
      callbacks: {},
      children: true,
      fields: { required: ["variant"], type: "object" },
    },
  ])("uses a fragment when Box cannot wrap the example: %j", async (Box) => {
    const targetDirectory = await createTempDir();
    await generateApp({
      ...defaultOptions,
      schema: { ...defaultOptions.schema, components: { Box } },
      targetDirectory,
    });
    const view = await readFile(
      path.join(targetDirectory, "src/slots/sidebar/customers.view.tsx"),
      "utf-8"
    );
    expect(view).toContain("return <>");
    expect(view).not.toContain("Box");
  });

  // SAFETY: The fixture controls this value; this assertion bridges the minimal test double to the API whose behavior is asserted below.
  it.each([
    {},
    { slots: {}, views: { "/accounts": {} } },
    { slots: { panel: { views: ["/missing"] } }, views: { "/accounts": {} } },
  ] as TailorKitSchemaFile[])(
    "rejects hosts without a renderable view before writing files: %j",
    async (schema) => {
      const targetDirectory = await createTempDir();
      await expect(
        generateApp({ ...defaultOptions, schema, targetDirectory })
      ).rejects.toThrow("no views supported by a slot");
      await expect(
        readFile(path.join(targetDirectory, "package.json"))
      ).rejects.toThrow();
    }
  );

  it("does not overwrite existing bindings without force", async () => {
    const targetDirectory = await createTempDir();
    await mkdir(path.join(targetDirectory, "src"));
    const bindings = path.join(targetDirectory, "src/tailorkit.gen.ts");
    await writeFile(bindings, "existing bindings");
    await expect(
      generateApp({ ...defaultOptions, targetDirectory })
    ).rejects.toThrow("already exists");
    expect(await readFile(bindings, "utf-8")).toBe("existing bindings");
  });
});
