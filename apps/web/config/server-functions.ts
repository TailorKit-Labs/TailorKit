import { rm } from "node:fs/promises";
import nodePath from "node:path";

import { build, createNitro, prepare } from "nitro/builder";
import type { Nitro, NitroModule } from "nitro/types";

const { resolve } = nodePath;

interface ServerFunction {
  name: string;
  destination: string;
  maxDuration?: number;
}

interface ApiFunction extends ServerFunction {
  route: string;
  source: string;
}

export const apiFunctions: ApiFunction[] = [
  {
    name: "mcp",
    route: "/api/platform/app-agent/mcp",
    source: "^/api/platform/app-agent/mcp/?$",
    destination: "api/platform/app-agent/mcp",
    // MCP streams stay open for the entire durable agent turn.
    maxDuration: 1800,
  },
  {
    name: "platform",
    route: "/api/platform/**",
    source: "^/api/platform(?:/.*)?$",
    destination: "api/platform/[...]",
  },
  {
    name: "auth",
    route: "/api/auth/**",
    source: "^/api/auth(?:/.*)?$",
    destination: "api/auth/[...]",
  },
  {
    name: "rpc",
    route: "/api/rpc/**",
    source: "^/api/rpc(?:/.*)?$",
    destination: "api/rpc/[...]",
  },
  {
    name: "assets",
    route: "/api/assets/**",
    source: "^/api/assets(?:/.*)?$",
    destination: "api/assets/[...]",
  },
];

const buildServerFunction = async (
  server: Nitro,
  entry: ServerFunction,
  service: string
) => {
  const outputDir = resolve(
    server.options.buildDir,
    "server-functions",
    entry.name,
    "output"
  );
  const functions = { ...server.options.vercel?.functions };
  const destination = resolve(
    server.options.output.dir,
    "functions",
    `${entry.destination}.func`
  );
  if (entry.maxDuration !== undefined) {
    functions.maxDuration = entry.maxDuration;
  }
  // Compile each Vite service separately; functionRules copy the shared output.
  const isolated = await createNitro({
    builder: "rolldown",
    buildDir: resolve(outputDir, "../build"),
    compatibilityDate: server.options.compatibilityDate,
    inlineDynamicImports: false,
    minify: true,
    output: {
      dir: outputDir,
      publicDir: resolve(outputDir, "static"),
      serverDir: destination,
    },
    preset: "vercel",
    rootDir: server.options.rootDir,
    rolldownConfig: { output: { codeSplitting: true } },
    routeRules: server.options.routeRules,
    serverDir: false,
    serverEntry: {
      handler: resolve(
        server.options.buildDir,
        "vite/services",
        service,
        "index.js"
      ),
    },
    vercel: {
      functions,
    },
    workspaceDir: server.options.workspaceDir,
  });
  try {
    // Nitro can emit a symlink to the shared bundle for these routes.
    // Remove it before building directly into the function directory.
    await rm(destination, { force: true, recursive: true });
    await prepare(isolated);
    await build(isolated);
  } finally {
    await isolated.close();
  }
};

const buildServerFunctions = async (server: Nitro) => {
  if (server.options.dev || server.options.preset !== "vercel") {
    return;
  }
  for (const entry of apiFunctions) {
    // oxlint-disable-next-line no-await-in-loop -- Each build runs a bundler; keep them sequential to bound build memory and worker usage.
    await buildServerFunction(server, entry, `api_${entry.name}`);
  }

  // Workflow's callback functions have already copied the shared execution
  // bundle. Replace only the UI fallback with its own SSR dependency graph.
  await buildServerFunction(
    server,
    { name: "ssr", destination: "__server" },
    "ssr"
  );
};

export const isolatedServerFunctions: NitroModule = {
  name: "isolated-server-functions",
  setup(server) {
    server.hooks.hook("build:before", () => {
      if (server.options.dev) {
        return;
      }
      // Workflow registers its execution handlers eagerly.
      for (const handler of server.options.handlers) {
        if (handler.route?.startsWith("/.well-known/workflow/")) {
          handler.lazy = true;
        }
      }
    });
    server.hooks.hook("compiled", buildServerFunctions);
  },
};
