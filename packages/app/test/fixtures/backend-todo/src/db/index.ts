import { defineDatabase } from "tailorkit/server";

import { relations } from "./relations";

export const db = defineDatabase({ relations });

// oxlint-disable-next-line oxc/no-barrel-file -- This file is a supported package or framework entry point; preserve its public exports.
export * from "./schema";
