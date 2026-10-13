import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";

export default defineConfig({
  extends: [core, react],
  ignorePatterns: [
    ...core.ignorePatterns,
    ".agents/skills",
    ".claude/skills",
    "apps/apps-worker/src/worker-env.d.ts",
  ],
  overrides: [
    ...core.overrides,
    {
      // Only centralized environment modules may read the host environment.
      files: [
        "packages/env/src/index.ts",
        "packages/vite/src/builder/env.ts",
        "packages/cli/src/env.ts",
        "playground/shared/src/env.ts",
        "playground/tanstack-start/src/env.ts",
      ],
      rules: {
        "no-restricted-properties": "off",
      },
    },
  ],
  rules: {
    "no-restricted-properties": [
      "error",
      {
        message:
          "Use this package's #env module and define local values in .env or .env.local.",
        object: "process",
        property: "env",
      },
    ],
  },
});
