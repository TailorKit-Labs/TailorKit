import { readFile, writeFile } from "node:fs/promises";

import { setConfigAppId } from "@tailorkit/vite/config/app-link";

export const writeAppIdToConfig = async (
  configPath: string,
  appId: string
): Promise<void> => {
  const source = await readFile(configPath, "utf-8");
  await writeFile(
    configPath,
    await setConfigAppId(source, appId, configPath),
    "utf-8"
  );
};
