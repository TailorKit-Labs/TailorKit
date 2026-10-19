import path from "node:path";

import { cosmiconfig } from "cosmiconfig";
import * as v from "valibot";

import type { ResolvedPatchSmithConfig } from "./config";
import { patchsmithConfigSchema } from "./config";

export interface LoadedPatchSmithConfig {
  config: ResolvedPatchSmithConfig;
  filepath: string;
  root: string;
}

const explorer = cosmiconfig("patchsmith", {
  searchPlaces: [
    "patchsmith.config.ts",
    "patchsmith.config.mjs",
    "patchsmith.config.js",
  ],
});

export const loadPatchSmithConfig = async (
  configPath: string | undefined,
  cwd = process.cwd()
): Promise<LoadedPatchSmithConfig> => {
  const searchFrom = path.resolve(cwd);
  const result =
    configPath === undefined
      ? await explorer.search(searchFrom)
      : await explorer.load(path.resolve(searchFrom, configPath));

  if (result === null) {
    throw new Error(`Could not find patchsmith config from ${searchFrom}.`);
  }
  return {
    config: v.parse(patchsmithConfigSchema, result.config),
    filepath: result.filepath,
    root: path.dirname(result.filepath),
  };
};
