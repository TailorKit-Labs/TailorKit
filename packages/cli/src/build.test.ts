import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vite-plus/test";
import { buildProject } from "./build";

it("builds the app's Vite config with custom plugins, aliases, constants and output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-vite-config-"));
  try {
    await symlink(
      path.resolve(import.meta.dirname, "../../vite/test/fixtures/backend-todo/node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(
      path.join(root, "tailorkit.config.mjs"),
      'export default { host: "https://host.test", server: {} };',
    );
    await writeFile(path.join(root, "src/message.ts"), 'export const message = "CUSTOM_ALIAS";');
    await writeFile(
      path.join(root, "src/root.tsx"),
      `
      import { defineRoute } from "tailorkit/client";
      import { message } from "@/message";
      import value from "virtual:example";
      export default defineRoute({ shellComponent: () => message + value + CUSTOM_CONSTANT });
    `,
    );
    await writeFile(
      path.join(root, "src/server.ts"),
      `
      import { defineServer, fn } from "tailorkit/server";
      import { message } from "@/message";
      import value from "virtual:example";
      export default defineServer({ read: fn.query.handler(() => message + value + CUSTOM_CONSTANT) });
    `,
    );
    await writeFile(
      path.join(root, "vite.config.mjs"),
      `
      import { tailorkit } from "tailorkit/vite";
      export default {
        plugins: [tailorkit({ cwd: import.meta.dirname }), {
          name: "example-transform",
          resolveId(id) { if (id === "virtual:example") return "\\0example"; },
          load(id) { if (id === "\\0example") return 'export default "CUSTOM_PLUGIN";'; },
        }],
        resolve: { alias: { "@": import.meta.dirname + "/src" } },
        define: { CUSTOM_CONSTANT: JSON.stringify("CUSTOM_DEFINE") },
        build: { outDir: "artifacts", sourcemap: true },
      };
    `,
    );
    const { outDir } = await buildProject({ cwd: root });
    expect(outDir).toBe(path.join(await realpath(root), "artifacts"));
    for (const filename of ["client/client.js", "server/server.js"]) {
      const source = await readFile(path.join(outDir, filename), "utf8");
      expect(source).toContain("CUSTOM_ALIAS");
      expect(source).toContain("CUSTOM_PLUGIN");
      expect(source).toContain("CUSTOM_DEFINE");
    }
    expect(
      JSON.parse(await readFile(path.join(outDir, "tailorkit-upload.json"), "utf8")),
    ).toMatchObject({
      assets: { client: "client/client.js", server: "server/server.js" },
    });
    expect(await readFile(path.join(outDir, "client/client.js.map"), "utf8")).toBeTruthy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

it("requires the TailorKit plugin when deploying", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tailorkit-missing-plugin-"));
  try {
    await symlink(
      path.resolve(import.meta.dirname, "../../vite/test/fixtures/backend-todo/node_modules"),
      path.join(root, "node_modules"),
      "dir",
    );
    await writeFile(path.join(root, "package.json"), '{"type":"module"}');
    await writeFile(path.join(root, "vite.config.mjs"), "export default {};");
    await expect(buildProject({ cwd: root })).rejects.toThrow("Add tailorkit()");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
