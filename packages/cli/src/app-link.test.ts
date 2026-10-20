import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { writeAppIdToConfig } from "./app-link";

let root: string;
let configPath: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "patchsmith-app-link-"));
  configPath = path.join(root, "patchsmith.config.ts");
});
afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("app linking", () => {
  it.each([
    {
      expected:
        'export default { host: "https://host.test", appId: "chosen-app" };\n',
      source:
        'export default { host: "https://host.test", appId: undefined };\n',
    },
    {
      expected:
        'export default defineConfig({ appId: "chosen-app", host: "https://host.test" });\n',
      source: 'export default defineConfig({ host: "https://host.test" });\n',
    },
    {
      expected:
        'const other = {\n  appId: "unrelated",\n};\nconst config = {\n  appId: "chosen-app",\n  host: "https://host.test",\n};\nexport default config;\n',
      source:
        'const other = {\n  appId: "unrelated",\n};\nconst config = {\n  host: "https://host.test",\n};\nexport default config;\n',
    },
  ])(
    "updates only the exported config in $source",
    async ({ source, expected }) => {
      await writeFile(configPath, source);
      await writeAppIdToConfig(configPath, "chosen-app");
      expect(await readFile(configPath, "utf-8")).toBe(expected);
    }
  );
  it("reports the app ID if the config cannot be updated", async () => {
    await writeFile(configPath, "export default getConfig();\n");
    await expect(writeAppIdToConfig(configPath, "chosen-app")).rejects.toThrow(
      'Add appId: "chosen-app" manually.'
    );
  });
});
