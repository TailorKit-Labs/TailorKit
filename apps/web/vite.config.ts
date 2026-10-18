import nodePath from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
import { workflow } from "workflow/vite";

import { env } from "#env";

import {
  apiFunctions,
  isolatedServerFunctions,
} from "./config/server-functions";

const { resolve } = nodePath;

const serverPackages = [
  "@tailorkit/api",
  "@tailorkit/api-utils",
  "@tailorkit/auth",
  "@tailorkit/db",
  "@tailorkit/env",
  "@tailorkit/observability",
  "libfx",
];

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const isTest = mode === "test";
  const reactPlugin = viteReact({ compiler: true });

  return {
    define: {
      "import.meta.env.VITE_ORG_CREATION_MANAGED": JSON.stringify(
        env.VERCEL_ENV === "production"
      ),
      "import.meta.env.VITE_VERCEL_DEPLOYMENT_ID": JSON.stringify(
        env.VERCEL_DEPLOYMENT_ID ?? ""
      ),
      "import.meta.env.VITE_VERCEL_SKEW_PROTECTION_ENABLED": JSON.stringify(
        env.VERCEL_SKEW_PROTECTION_ENABLED === "1"
      ),
    },
    plugins: isTest
      ? [reactPlugin]
      : lazyPlugins(() => [
          workflow({
            dirs: [resolve(import.meta.dirname, "workflows")],
            runtime: "nodejs24.x",
          }),
          devtools(),
          tailwindcss(),
          tanstackStart({}),
          nitro({
            // Compile API services through Vite so Workflow transforms still apply.
            experimental: {
              vite: {
                services: Object.fromEntries(
                  apiFunctions.map(({ name }) => [
                    `api_${name}`,
                    {
                      entry: resolve(
                        import.meta.dirname,
                        `src/server/api/${name}.ts`
                      ),
                    },
                  ])
                ),
              },
            },
            // Keep libfx beside its native addons and include all platform assets.
            traceDeps: ["libfx*"],
            // Workflow 5 still reads Nitro's legacy externals option when bundling steps.
            // oxlint-disable-next-line unicorn/no-useless-spread -- Workflow 5 reads this Nitro v2 option; Nitro v3 types omit it.
            ...{ externals: { external: ["libfx"] } },
            routes: Object.fromEntries(
              apiFunctions.map(({ name, route }) => [
                route,
                {
                  format: "web",
                  handler: resolve(
                    import.meta.dirname,
                    `src/server/api/${name}.ts`
                  ),
                  lazy: true,
                },
              ])
            ),

            // Split server code into chunks and minify every generated function.
            inlineDynamicImports: false,
            minify: true,
            rolldownConfig: { output: { codeSplitting: true } },
            modules: [isolatedServerFunctions],

            routeRules: {
              "/sign-in": {
                redirect: {
                  status: 308,
                  to: "/login",
                },
              },
              "/signin": {
                redirect: {
                  status: 308,
                  to: "/login",
                },
              },
              "/signup": {
                redirect: {
                  status: 308,
                  to: "/sign-up",
                },
              },
            },

            serverDir: false,

            vercel: {
              config: {
                version: 3,
                routes: apiFunctions.map(({ source, destination }) => ({
                  src: source,
                  dest: `/${destination}`,
                })),
              },
            },

            // Workflow's Nitro builder must resolve package IDs from the same
            // app root as its Vite transform, rather than the monorepo root.
            workspaceDir: import.meta.dirname,
          }),
          reactPlugin,
        ]),
    server: {
      port: 3000,
    },
    ssr: {
      external: isDev ? undefined : serverPackages,
      noExternal: [
        "@tailorkit/api-platform",
        "@tailorkit/agent",
        "@tailorkit/agent-fx",
      ],
    },
  };
});
