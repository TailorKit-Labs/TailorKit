import path from "node:path";

import { build } from "vite-plus";
import { expect, it } from "vite-plus/test";

it("bundles the core runtime without loading React or Preact modules in the host", async () => {
  const modules: string[] = [];
  await build({
    build: {
      lib: {
        entry: path.join(import.meta.dirname, "index.ts"),
        formats: ["es"],
      },
      minify: false,
      write: false,
    },
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "framework-boundary",
        generateBundle() {
          modules.push(...this.getModuleIds());
        },
      },
    ],
  });
  expect(
    modules.some((id) =>
      /\/node_modules\/(?:react|react-dom|preact)(?:\/|$)/u.test(id)
    )
  ).toBe(false);
  expect(modules.some((id) => /\/core\/dist\/spec(?:\.|\/)/u.test(id))).toBe(
    false
  );
  expect(modules.some((id) => /\/core\/dist\/server(?:\.|\/)/u.test(id))).toBe(
    false
  );
  expect(
    modules.some((id) =>
      /\/node_modules\/@nanostores\/(?:react|preact)\//u.test(id)
    )
  ).toBe(false);
});
