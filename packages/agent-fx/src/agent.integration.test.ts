import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import { promisify } from "node:util";

import {
  createHarnessWorkflowState,
  runHarnessAgentStep,
} from "@ai-sdk/workflow-harness";
import type { HarnessWorkflowChunk } from "@ai-sdk/workflow-harness";
import type { Experimental_SandboxSession } from "ai";
import { expect, it, vi } from "vite-plus/test";

import { env } from "#env";

import { createAppAgent } from "./agent";

const { dirname, join } = nodePath;
// oxlint-disable-next-line typescript/strict-void-return -- promisify consumes execFile's completion callback, not its ChildProcess return value.
const execute = promisify(execFile);
const bytes = async (path: string) => await readFile(path).catch(() => null);
const write = async (path: string, content: Uint8Array | string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

/** The real fx adapter talks to this disposable filesystem and shell. */
const localSession = (
  workspace: string,
  sessionHome: string
): Experimental_SandboxSession => ({
  description: "Disposable fx integration fixture",
  readBinaryFile: async ({ path }) => await bytes(path),
  readFile: async ({ path }) => {
    const content = await bytes(path);
    return content
      ? new ReadableStream({
          start(controller) {
            controller.enqueue(content);
            controller.close();
          },
        })
      : null;
  },
  readTextFile: async ({ path }) => {
    const content = await bytes(path);
    return content?.toString("utf-8") ?? null;
  },
  run: async ({ command, env: commandEnv, workingDirectory, abortSignal }) => {
    if (command === `printf '%s' "$HOME" | base64 -w0`) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: Buffer.from(sessionHome).toString("base64"),
      };
    }
    const gnu = "/opt/homebrew/opt/coreutils/libexec/gnubin";
    const path = existsSync(gnu) ? `${gnu}:/usr/bin:/bin` : "/usr/bin:/bin";
    const { stdout, stderr } = await execute("bash", ["-c", command], {
      cwd: workingDirectory ?? workspace,
      env: { PATH: path, ...commandEnv },
      signal: abortSignal,
    });
    return { exitCode: 0, stderr, stdout };
  },
  spawn: () => {
    throw new Error("fx must not spawn a sandbox bridge.");
  },
  writeBinaryFile: async ({ path, content }) => {
    await write(path, content);
  },
  writeFile: async ({ path, content }) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    await write(path, Buffer.concat(chunks));
  },
  writeTextFile: async ({ path, content }) => {
    await write(path, content);
  },
});

const gatewayEvents = (first: boolean, text: string) => {
  const parts = [
    { type: "stream-start", warnings: [] },
    ...(first
      ? [
          {
            input: JSON.stringify({
              content: "First turn",
              file_path: "example.txt",
            }),
            toolCallId: "write-1",
            toolName: "write",
            type: "tool-call",
          },
        ]
      : [
          { id: "text-1", type: "text-start" },
          { delta: text, id: "text-1", type: "text-delta" },
          { id: "text-1", type: "text-end" },
        ]),
    {
      finishReason: {
        raw: first ? "tool_calls" : "stop",
        unified: first ? "tool-calls" : "stop",
      },
      type: "finish",
      usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
    },
  ];
  return parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("");
};

it.each(["api-key", "runtime-oidc"])(
  "uses stock fx tools, skills and durable turns with %s",
  async (mode) => {
    const originalEnv = { ...env };
    delete env.AI_GATEWAY_API_KEY;
    delete env.VERCEL_OIDC_TOKEN;
    env.AI_GATEWAY_BASE_URL = "https://gateway.test";
    const token =
      mode === "api-key"
        ? "local-test-token"
        : `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.signature`;
    if (mode === "api-key") {
      env.AI_GATEWAY_API_KEY = token;
    }
    vi.stubGlobal(Symbol.for("@vercel/request-context"), {
      get: () => ({
        headers:
          mode === "runtime-oidc" ? { "x-vercel-oidc-token": token } : {},
      }),
    });
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), "tailorkit-fx-"))
    );
    const workspace = join(directory, "app");
    const sessionHome = join(directory, "home");
    await mkdir(workspace);
    await mkdir(sessionHome);
    const requests: {
      body: string;
      authorization: string | null;
      url: string;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url, options) => {
        const request = new Request(url, options);
        if (request.method === "GET") {
          return Response.json({ data: [] });
        }
        const body = await request.text();
        requests.push({
          authorization: request.headers.get("authorization"),
          body,
          url: request.url,
        });
        return new Response(
          gatewayEvents(
            requests.length === 1,
            body.includes("Now update it") ? "Updated" : "Built"
          ),
          { headers: { "content-type": "text/event-stream" } }
        );
      })
    );
    const input = {
      agentToken: "private-deployment-token",
      appId: randomUUID(),
      hostUrl: "https://host.test/api/tailorkit",
      messages: [],
      model: "openai/gpt-6.1-sol",
      threadId: randomUUID(),
    };
    const sandboxSession = localSession(workspace, sessionHome);
    let session:
      | Awaited<
          ReturnType<
            Awaited<ReturnType<typeof createAppAgent>>["createSession"]
          >
        >
      | undefined;
    try {
      const agent = await createAppAgent(input, "fixture");
      expect(agent.harnessId).toBe("fx");
      expect(requests).toHaveLength(0);
      const chunks: HarnessWorkflowChunk[] = [];
      const writable = () =>
        new WritableStream<HarnessWorkflowChunk>({
          write(chunk) {
            chunks.push(chunk);
          },
        });
      let state = await runHarnessAgentStep({
        agent,
        sandboxSession,
        state: createHarnessWorkflowState({
          prompt: "Build a file",
          sessionId: input.threadId,
        }),
        writable: writable(),
      });
      expect(state.status).toBe("ready_for_next_step");
      expect(state.continueFrom?.harnessId).toBe("fx");
      expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
      expect(await readFile(join(workspace, "example.txt"), "utf-8")).toBe(
        "First turn"
      );
      state = await runHarnessAgentStep({
        agent: await createAppAgent(input, "fixture"),
        sandboxSession,
        state,
        writable: writable(),
      });
      expect(state.status).toBe("finished");
      expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
      expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
      expect(chunks).toContainEqual(
        expect.objectContaining({
          input: { content: "First turn", file_path: "example.txt" },
          toolName: "write",
          type: "tool-input-available",
        })
      );
      expect(chunks).toContainEqual(
        expect.objectContaining({ type: "tool-output-available" })
      );
      expect(chunks).toContainEqual(
        expect.objectContaining({ delta: "Built", type: "text-delta" })
      );
      const { resumeFrom } = state;
      if (resumeFrom === undefined) {
        throw new Error("Missing fx resume state");
      }
      expect(resumeFrom.harnessId).toBe("fx");
      expect(JSON.stringify(resumeFrom)).not.toContain(token);
      const savedState = await readFile(
        join(
          sessionHome,
          ".ai-sdk/harness-fx",
          createHash("sha256").update(input.threadId).digest("hex"),
          "state.json"
        ),
        "utf-8"
      );
      expect(savedState).not.toContain(token);
      expect(savedState).not.toContain(input.agentToken);
      const nextAgent = await createAppAgent(
        { ...input, agentToken: "fresh-deployment-token" },
        "fixture"
      );
      session = await nextAgent.createSession({
        resumeFrom,
        sandboxSession,
        sessionId: input.threadId,
      });
      const next = await nextAgent.generate({
        prompt: "Now update it",
        session,
      });
      expect(next.text).toBe("Updated");
      expect(requests.at(-1)?.body).toContain("Build a file");
      expect(requests.at(-1)?.body).toContain("Now update it");
      for (const request of requests) {
        expect(request.url).toBe("https://gateway.test/v4/ai/language-model");
        expect(request.authorization).toBe(`Bearer ${token}`);
        expect(request.body).not.toContain("private-deployment-token");
        expect(request.body).not.toContain(token);
      }
      for (const name of ["tailorkit-ui", "tailorkit-backend"]) {
        expect(requests[0]?.body).toContain(name);
      }
      expect(requests[0]?.body).toContain("deploy");
    } finally {
      await session?.destroy();
      delete env.AI_GATEWAY_API_KEY;
      delete env.AI_GATEWAY_BASE_URL;
      delete env.VERCEL_OIDC_TOKEN;
      Object.assign(env, originalEnv);
      vi.unstubAllGlobals();
      await rm(directory, { force: true, recursive: true });
    }
  },
  30_000
);
