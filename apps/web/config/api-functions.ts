import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";

import { build, createNitro, prepare } from "nitro/builder";
import type { Nitro, NitroModule } from "nitro/types";
import { z } from "zod";

const { dirname, resolve } = nodePath;

interface ApiFunction {
  name: string;
  route: string;
  source: string;
  destination: string;
  maxDuration?: number;
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

const buildOutputSchema = z.looseObject({
  routes: z.array(
    z.looseObject({
      dest: z.string().optional(),
    })
  ),
});

const buildApiFunction = async (server: Nitro, entry: ApiFunction) => {
  const outputDir = resolve(
    server.options.buildDir,
    "api-functions",
    entry.name,
    "output"
  );
  const functions = { ...server.options.vercel?.functions };
  if (entry.maxDuration !== undefined) {
    functions.maxDuration = entry.maxDuration;
  }
  // Compile one Vite service at a time; functionRules copy the shared SSR output.
  const api = await createNitro({
    builder: "rolldown",
    buildDir: resolve(outputDir, "../build"),
    compatibilityDate: server.options.compatibilityDate,
    inlineDynamicImports: false,
    minify: true,
    output: {
      dir: outputDir,
      publicDir: resolve(outputDir, "static"),
      serverDir: resolve(outputDir, "functions/__server.func"),
    },
    preset: "vercel",
    rootDir: server.options.rootDir,
    serverDir: false,
    serverEntry: {
      handler: resolve(
        server.options.buildDir,
        "vite/services",
        `api_${entry.name}`,
        "index.js"
      ),
    },
    vercel: {
      functions,
    },
    workspaceDir: server.options.workspaceDir,
    hooks: {
      "rollup:before": (_api, config) => {
        if (config.output !== undefined && "codeSplitting" in config.output) {
          Object.assign(config.output, { codeSplitting: true });
        }
      },
    },
  });
  try {
    await prepare(api);
    await build(api);
    const destination = resolve(
      server.options.output.dir,
      "functions",
      `${entry.destination}.func`
    );
    await rm(destination, { force: true, recursive: true });
    await mkdir(dirname(destination), { recursive: true });
    await cp(api.options.output.serverDir, destination, {
      recursive: true,
      verbatimSymlinks: true,
    });
  } finally {
    await api.close();
  }
};

const buildApiFunctions = async (server: Nitro) => {
  for (const entry of apiFunctions) {
    // oxlint-disable-next-line no-await-in-loop -- Each build runs a bundler; keep them sequential to bound build memory and worker usage.
    await buildApiFunction(server, entry);
  }

  const configFile = resolve(server.options.output.dir, "config.json");
  const config = buildOutputSchema.parse(
    JSON.parse(await readFile(configFile, "utf-8"))
  );
  const destinations = new Set(
    apiFunctions.map((entry) => `/${entry.destination}`)
  );
  config.routes = config.routes.filter(
    (route) => route.dest === undefined || !destinations.has(route.dest)
  );
  const fallback = config.routes.findIndex(
    (route) => route.dest === "/__server"
  );
  if (fallback === -1) {
    throw new Error("Nitro's Vercel fallback route is missing.");
  }
  config.routes.splice(
    fallback,
    0,
    ...apiFunctions.map((entry) => ({
      src: entry.source,
      dest: `/${entry.destination}`,
    }))
  );
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
};

export const isolatedApiFunctions: NitroModule = {
  name: "isolated-api-functions",
  setup(server) {
    server.hooks.hook("compiled", async () => {
      if (!server.options.dev && server.options.preset === "vercel") {
        await buildApiFunctions(server);
      }
    });
  },
};
