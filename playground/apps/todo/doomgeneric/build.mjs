import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const cache = `${root}.cache/doomgeneric`;
const revision = "e257a09527062bfb986b6e5e0780839b6cbd5b71";
const compiler =
  "emscripten/emsdk:3.1.74@sha256:af45409f3199d88db4b1b03af0098532c8fb33a375ac257463eeb0a622870d06";
await mkdir(cache, { recursive: true });
/** @param {string} name @param {string} url @param {string} sha256 */
const download = async (name, url, sha256) => {
  const path = `${cache}/${name}`;
  let data;
  try {
    data = await readFile(path);
  } catch {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${url} (${response.status})`);
    }
    data = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(data).digest("hex") !== sha256) {
    throw new Error(`Checksum mismatch for ${name}`);
  }
  await writeFile(path, data);
  return path;
};
const source = await download(
  "doomgeneric.tar.gz",
  `https://codeload.github.com/ozkl/doomgeneric/tar.gz/${revision}`,
  "26f8f60daa6c6e4d3c01e5eac9fb700d592dede803d13ac848154ff356b2a2e7"
);
const data = await download(
  "freedoom.zip",
  "https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip",
  "3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59"
);
execFileSync("tar", ["-xzf", source, "-C", cache]);
execFileSync(
  "unzip",
  [
    "-o",
    data,
    "freedoom-0.13.0/freedoom1.wad",
    "freedoom-0.13.0/COPYING.txt",
    "-d",
    cache,
  ],
  { stdio: "inherit" }
);
const sourceRoot = `${cache}/doomgeneric-${revision}/doomgeneric`;
const makefile = await readFile(`${sourceRoot}/Makefile`, "utf-8");
const objects = /^SRC_DOOM = (?<objects>.+)$/mu.exec(makefile)?.groups?.objects;
if (objects === undefined || objects.length === 0) {
  throw new Error("DoomGeneric source list missing");
}
// The upstream melt transition busy-waits inside a tick. Disable only that effect
// in this port; rendering and gameplay remain DoomGeneric's real implementation.
const mainPath = `${sourceRoot}/d_main.c`;
const main = await readFile(mainPath, "utf-8");
const condition = "if (gamestate != wipegamestate)";
if (!main.includes(condition)) {
  throw new Error("DoomGeneric wipe patch no longer applies");
}
await writeFile(
  mainPath,
  main.replace(
    condition,
    "if (0) /* TailorKit: yield between frames, no blocking melt. */"
  )
);
const sources = objects
  .split(/\s+/u)
  .filter((name) => name !== "doomgeneric_xlib.o")
  .map((name) => name.replace(/\.o$/u, ".c"));
execFileSync(
  "docker",
  [
    "run",
    "--rm",
    "--network=none",
    "--platform=linux/amd64",
    "-v",
    `${root}:/work`,
    "-w",
    `/work/.cache/doomgeneric/doomgeneric-${revision}/doomgeneric`,
    compiler,
    "emcc",
    ...sources,
    "/work/doomgeneric/doomgeneric_tailorkit.c",
    "-I.",
    "-O2",
    "-DDOOMGENERIC_RESX=320",
    "-DDOOMGENERIC_RESY=200",
    "-D_DEFAULT_SOURCE",
    "-Wno-incompatible-function-pointer-types",
    "-Wno-int-conversion",
    "-sWASM=0",
    "-sDYNAMIC_EXECUTION=0",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sENVIRONMENT=web",
    "-sFORCE_FILESYSTEM=1",
    "-sEXPORTED_RUNTIME_METHODS=FS,HEAPU8",
    "-sINITIAL_MEMORY=67108864",
    "-sSTACK_SIZE=1048576",
    "-sINVOKE_RUN=0",
    "-sSINGLE_FILE=1",
    "-sASSERTIONS=0",
    "--no-entry",
    "-lm",
    "-o",
    "/work/.cache/doomgeneric/engine.mjs",
  ],
  { stdio: "inherit" }
);
const engine = await readFile(`${cache}/engine.mjs`, "utf-8");
const wad = await readFile(`${cache}/freedoom-0.13.0/freedoom1.wad`);
await writeFile(
  `${cache}/runtime.mjs`,
  `${engine}\nexport const wadBase64 = ${JSON.stringify(gzipSync(wad).toString("base64"))};\n`
);
console.log(
  `Built DoomGeneric ${revision}: JavaScript engine + Freedoom 0.13.0 (${wad.length} WAD bytes).`
);
