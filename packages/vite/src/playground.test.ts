import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { expect, it } from "vite-plus/test";
import { readClientManifest } from "./builder/client-views";

it("builds the playground todo app through its public Vite config", async () => {
  const root = path.resolve(import.meta.dirname, "../../../playground/apps/todo");
  const outDir = await mkdtemp(path.join(tmpdir(), "tailorkit-playground-build-"));
  try {
    await build({ root, configFile: path.join(root, "vite.config.ts"), build: { outDir } });
    const manifest = await readClientManifest(path.join(outDir, "client/client.js"));
    expect(manifest.views.length).toBeGreaterThan(0);
    expect(
      JSON.parse(await readFile(path.join(outDir, "tailorkit-upload.json"), "utf8")),
    ).toMatchObject({ version: 1, assets: { client: "client/client.js" } });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}, 30_000);
