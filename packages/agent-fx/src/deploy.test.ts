import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import { expect, it } from "vite-plus/test";
import { z } from "zod";

import { createDeployTool, publish } from "./deploy";
import type { AppSandboxSession } from "./sandbox-session";

const scope = { name: "user", value: { userId: "owner" } };
const authorization = {
  agentToken: `header.${Buffer.from(JSON.stringify({ platformUrl: "https://platform.test", scope })).toString("base64url")}.signature`,
  appId: "23f9b80a-bce5-46c8-8fa4-6a319fd5be37",
};
const manifest = {
  assets: {
    client: "client/client.js",
    logos: { dark: "client/logo-dark.svg" },
    server: "server/server.js",
  },
  version: 1,
  views: [{ path: "/", slot: "panel" }],
};
const upload = (name: string) => ({
  uploadUrl: `https://storage.test/${name}`,
});
const reader = (document = JSON.stringify(manifest)) => ({
  readFileToBuffer: async ({ path }: { path: string }) =>
    await Promise.resolve(
      Buffer.from(
        path.endsWith("tailorkit-upload.json") ? document : "fixture bytes"
      )
    ),
});

const checks = ["format:fix", "lint", "format", "test", "typecheck", "build"];
const runDeployment = async (
  options: { failedCheck?: string; scripts?: Record<string, string> } = {}
) => {
  const commands: Parameters<AppSandboxSession["runCommand"]>[0][] = [];
  let published = false;
  const scripts = options.scripts ?? {
    format: "vp fmt --check",
    "format:fix": "vp fmt",
    lint: "vp lint",
    test: "vp test",
  };
  const tool = createDeployTool({
    publish: async () => {
      published = true;
      return await Promise.resolve({ id: "deployment" });
    },
    sandbox: async () =>
      await Promise.resolve({
        readFileToBuffer: async () =>
          await Promise.resolve(Buffer.from(JSON.stringify({ scripts }))),
        runCommand: async (command) => {
          commands.push(command);
          const args = command.args ?? [];
          let [, name] = args;
          if (args[0] !== "run") {
            name = args[1] === "tsc" ? "typecheck" : "build";
          }
          const failed = options.failedCheck === name;
          return await Promise.resolve({
            exitCode: failed ? 1 : 0,
            stderr: async () =>
              await Promise.resolve(
                failed ? `Fix source: ${authorization.agentToken}` : ""
              ),
            stdout: async () =>
              await Promise.resolve(
                failed ? authorization.agentToken : "verbose success log"
              ),
          });
        },
      }),
  });
  const result = await tool.execute(
    {},
    {
      context: { ...authorization, sandboxName: "sandbox" },
      messages: [],
      toolCallId: "deploy",
    }
  );
  if (!("exitCode" in result)) {
    throw new Error("Deploy must return a completed command result.");
  }
  return { commands, published, result };
};

it("runs all checks once before publishing, with credentials confined to the host", async () => {
  const { commands, published, result } = await runDeployment();
  expect(published).toBe(true);
  expect(commands.map((command) => command.args?.slice(0, 2))).toEqual([
    ["run", "format:fix"],
    ["run", "lint"],
    ["run", "format"],
    ["run", "test"],
    ["exec", "tsc"],
    ["exec", "node"],
  ]);
  expect(commands[3]?.args).toEqual(["run", "test", "--passWithNoTests"]);
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  for (const check of checks) {
    expect(result.stdout).toContain(`${check} passed (`);
  }
  expect(result.stdout).toContain("Deployment: deployment");
  expect(result.stdout).not.toContain("verbose success log");
  for (const command of commands) {
    expect(command.env).toEqual({ CI: "true", NO_COLOR: "1" });
    expect(JSON.stringify(command)).not.toContain(authorization.agentToken);
  }
});

it.each(checks)(
  "returns %s diagnostics and stops before further checks or publication",
  async (failedCheck) => {
    const { commands, published, result } = await runDeployment({
      failedCheck,
    });
    expect(published).toBe(false);
    expect(commands).toHaveLength(checks.indexOf(failedCheck) + 1);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`${failedCheck} failed (`);
    expect(result.stderr).toContain("Fix source: [redacted]");
    expect(result.stdout).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain(authorization.agentToken);
  }
);

it("supports a build-only app with no optional verification scripts", async () => {
  const { commands, published } = await runDeployment({ scripts: {} });
  expect(published).toBe(true);
  expect(commands.map((command) => command.args?.[1])).toEqual(["tsc", "node"]);
});

it("uses a standalone check script and preserves custom test arguments", async () => {
  const { commands, published } = await runDeployment({
    scripts: { check: "custom-check", test: "node --test" },
  });
  expect(published).toBe(true);
  expect(commands[0]?.args).toEqual(["run", "check"]);
  expect(commands[1]?.args).toEqual(["run", "test"]);
});

it("publishes client, server and logos using host authorization", async () => {
  // Validate the selector against the platform's generated HTTP contract,
  // rather than maintaining a second, potentially outdated app schema here.
  const contract = z
    .object({
      paths: z.object({
        "/deployments": z.object({
          post: z.object({
            requestBody: z.object({
              content: z.object({
                "application/json": z.object({
                  schema: z.object({
                    properties: z.object({
                      app: z.record(z.string(), z.json()),
                    }),
                    required: z.array(z.string()),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    })
    .parse(
      JSON.parse(
        await readFile(
          new URL("../../api-platform/openapi.json", import.meta.url),
          "utf-8"
        )
      )
    ).paths["/deployments"].post.requestBody.content["application/json"].schema;
  const selector = z.fromJSONSchema(contract.properties.app);
  const calls: Request[] = [];
  const send: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    calls.push(request);
    if (request.method === "PUT") {
      expect(request.headers.has("authorization")).toBe(false);
      const bytes = Buffer.from(await request.arrayBuffer());
      const raw =
        request.headers.get("content-encoding") === "gzip"
          ? gunzipSync(bytes)
          : bytes;
      expect(raw.toString()).toBe("fixture bytes");
      return new Response(null);
    }
    expect(request.headers.get("authorization")).toBe(
      `Bearer ${authorization.agentToken}`
    );
    const body = z.record(z.string(), z.json()).parse(await request.json());
    if (request.url.endsWith("/deployments")) {
      for (const field of contract.required) {
        expect(body).toHaveProperty(field);
      }
      expect(selector.parse(body.app)).toEqual({ id: authorization.appId });
      expect(body).toMatchObject({
        app: { id: authorization.appId },
        scope,
        views: manifest.views,
      });
      const code = gzipSync(Buffer.from("fixture bytes"));
      expect(body).toMatchObject({
        assets: [
          {
            checksum: createHash("sha256").update(code).digest("hex"),
            contentLength: code.byteLength,
            encoding: "gzip",
            objectKey: "client.js",
          },
        ],
      });
      return Response.json({
        assets: [upload("client")],
        deployment: { id: "deployment" },
        logos: { dark: upload("logo") },
        server: upload("server"),
      });
    }
    expect(body).toEqual({ rollout: true, scope });
    return Response.json({ id: "deployment" });
  };
  expect(await publish(reader(), authorization, undefined, send)).toEqual({
    id: "deployment",
  });
  const uploads = calls.filter((request) => request.method === "PUT");
  expect(uploads).toHaveLength(3);
  expect(calls.at(-1)?.url).toBe(
    "https://platform.test/deployments/deployment"
  );
});

it("includes platform diagnostics while redacting deployment credentials", async () => {
  const send: typeof fetch = async () =>
    await Promise.resolve(
      Response.json(
        {
          code: "BAD_REQUEST",
          data: {
            issues: [
              {
                message: `Expected app ${authorization.agentToken}`,
                path: ["app"],
              },
            ],
          },
          message: "Input validation failed",
        },
        { status: 400 }
      )
    );
  await expect(
    publish(reader(), authorization, undefined, send)
  ).rejects.toThrow(
    'Deployment request failed (400). BAD_REQUEST: Input validation failed: ["app"]: Expected app [redacted]'
  );
});

it.each([502, 503])(
  "reports non-JSON platform failures without masking status %s",
  async (status) => {
    const send: typeof fetch = async () =>
      await Promise.resolve(new Response("Service unavailable", { status }));
    await expect(
      publish(reader(), authorization, undefined, send)
    ).rejects.toThrow(`Deployment request failed (${status}).`);
  }
);

it("rejects a build manifest that escapes the output directory", async () => {
  let requests = 0;
  const send: typeof fetch = async () => {
    requests += 1;
    return await Promise.resolve(Response.json({}));
  };
  await expect(
    publish(
      reader(
        JSON.stringify({ ...manifest, assets: { client: "../../credentials" } })
      ),
      authorization,
      undefined,
      send
    )
  ).rejects.toThrow();
  expect(requests).toBe(0);
});

it("stops on denied authorization without uploading artifacts", async () => {
  const methods: string[] = [];
  const send: typeof fetch = async (url, init) => {
    methods.push(new Request(url, init).method);
    return await Promise.resolve(new Response(null, { status: 401 }));
  };
  await expect(
    publish(reader(), authorization, undefined, send)
  ).rejects.toThrow("401");
  expect(methods).toEqual(["POST"]);
});
