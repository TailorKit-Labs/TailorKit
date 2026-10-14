import { strict as effect } from "@effect/tsgo/oxlint-presets";
import formatting from "ultracite/oxfmt";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import { defineConfig } from "vite-plus";

const reactWorkspaces = [
  "apps/web/**",
  "packages/app/**",
  "packages/email/**",
  "packages/react/**",
  "packages/ui/**",
  "playground/apps/todo/**",
  "playground/tanstack-start/**",
];
const tanstackWorkspaces = ["apps/web", "playground/tanstack-start"];
const aliasWorkspaces = [
  "apps/web",
  "packages/agent",
  "packages/api",
  "packages/api-platform",
  "packages/api-utils",
  "packages/app",
  "packages/asset-delivery",
  "packages/auth",
  "packages/cli",
  "packages/client-core",
  "packages/client-platform",
  "packages/config",
  "packages/core",
  "packages/db",
  "packages/email",
  "packages/env",
  "packages/flags",
  "packages/kv",
  "packages/observability",
  "packages/react",
  "packages/sandbox",
  "packages/storage",
  "packages/tailorkit",
  "packages/ui",
  "packages/vite",
  "playground/apps/todo",
  "playground/tanstack-start",
];
const ignorePatterns = [
  ".agents/skills",
  ".claude/skills",
  "**/wrangler.json",
  "**/wrangler.jsonc",
  "**/wrangler.toml",
  "**/worker-env.d.ts",
  "**/.wrangler/**",
  "**/*.generated.*",
  "**/*.gen.*",
];

export default defineConfig({
  fmt: {
    ...formatting,
    ignorePatterns: [...(formatting.ignorePatterns ?? []), ...ignorePatterns],
    sortTailwindcss: {
      functions: ["clsx", "cva", "cn"],
      stylesheet: "./packages/ui/src/styles/globals.css",
    },
  },
  lint: {
    extends: [core, antiSlop, effect],
    ignorePatterns: [...(core.ignorePatterns ?? []), ...ignorePatterns],
    jsPlugins: [...antiSlop.jsPlugins, ...shadcn.jsPlugins],
    overrides: [
      ...(core.overrides ?? []),
      {
        files: aliasWorkspaces.map((workspace) => `${workspace}/src/**`),
        rules: {
          "import/no-relative-parent-imports": "error",
        },
      },
      {
        files: ["apps/web/**"],
        rules: shadcn.rules,
      },
      ...(shadcn.overrides ?? []).map((override) => ({
        ...override,
        files: override.files.map((pattern) => `apps/web/${pattern}`),
      })),
      {
        files: reactWorkspaces,
        plugins: react.plugins,
        rules: react.rules,
      },
      {
        files: tanstackWorkspaces.map((workspace) => `${workspace}/**`),
        plugins: tanstack.plugins,
        rules: tanstack.rules,
      },
      // Override paths are relative to this root config, including the
      // file-route exceptions supplied by the TanStack preset.
      ...(tanstack.overrides ?? []).map((override) => ({
        ...override,
        files: tanstackWorkspaces.flatMap((workspace) =>
          override.files.map((pattern) => `${workspace}/${pattern}`)
        ),
      })),
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
    settings: {
      shadcn: {
        ui: "@tailorkit/ui",
      },
    },
  },
  staged: {
    "*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}": "vp check --fix",
    "*.{json,jsonc,json5,md,mdx,yaml,yml,css,html}": "vp fmt",
  },
});
