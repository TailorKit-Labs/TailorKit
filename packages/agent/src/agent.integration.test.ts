import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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

import { toUIMessageStream } from "ai";
import type { Experimental_SandboxSession, UIMessageChunk } from "ai";
import { expect, it, vi } from "vite-plus/test";

import { createAppAgent } from "./agent";

vi.mock("#env", () => ({
  env: {
    AI_GATEWAY_API_KEY: "local-test-key",
    AI_GATEWAY_BASE_URL: "https://gateway.test",
  },
}));

const { dirname, join } = nodePath;
// oxlint-disable-next-line typescript/strict-void-return -- execFile also returns a ChildProcess; promisify consumes its completion callback, not that return value.
const execute = promisify(execFile);
const modelId = "xiaomi/mimo-v2.6-pro";
const model = {
  context_window: 1_048_576,
  id: modelId,
  max_tokens: 131_072,
  modalities: { input: ["text", "image", "audio", "video"] },
  name: "MiMo V2.6 Pro",
  pricing: { input: "0.000000435", output: "0.00000087" },
  tags: ["reasoning", "tool-use", "vision"],
};

const bytes = async (path: string) => await readFile(path).catch(() => null);
const write = async (path: string, content: Uint8Array | string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

/** Fixed test commands execute only against a disposable local workspace. */
const localSession = (
  workspace: string,
  sessionHome: string
): Experimental_SandboxSession => ({
  description: "Disposable local integration fixture",
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
  run: async ({ command, env, workingDirectory, abortSignal }) => {
    if (command === 'printf "%s" "$HOME"') {
      return { exitCode: 0, stderr: "", stdout: sessionHome };
    }
    const { stdout, stderr } = await execute("bash", ["-c", command], {
      cwd: workingDirectory ?? workspace,
      env: { PATH: "/usr/bin:/bin", ...env },
      signal: abortSignal,
    });
    return { exitCode: 0, stderr, stdout };
  },
  spawn: () => {
    throw new Error(
      "Pi should use the filesystem/shell API, not spawn a bridge."
    );
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

const messageEvents = (call: number) => {
  const first = call === 1;
  const events = [
    {
      message: {
        content: [],
        id: randomUUID(),
        model: modelId,
        role: "assistant",
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        usage: { input_tokens: 10, output_tokens: 0 },
      },
      type: "message_start",
    },
    {
      content_block: first
        ? { id: "write-1", input: {}, name: "write", type: "tool_use" }
        : { text: "", type: "text" },
      index: 0,
      type: "content_block_start",
    },
    {
      delta: first
        ? {
            partial_json: JSON.stringify({
              content: "First turn",
              file_path: "example.txt",
            }),
            type: "input_json_delta",
          }
        : { text: call === 2 ? "Built" : "Updated", type: "text_delta" },
      index: 0,
      type: "content_block_delta",
    },
    { index: 0, type: "content_block_stop" },
    {
      delta: {
        stop_reason: first ? "tool_use" : "end_turn",
        stop_sequence: null,
      },
      type: "message_delta",
      usage: { output_tokens: 5 },
    },
    { type: "message_stop" },
  ];
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
};

it("streams typed Pi file tools and restores a multi-turn conversation without the host journal", async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "tailorkit-pi-"))
  );
  const workspace = join(directory, "app");
  const sessionHome = join(directory, "home");
  const sessionId = randomUUID();
  const hostJournal = join(tmpdir(), "ai-sdk-harness", "pi", sessionId);
  await mkdir(workspace);
  await mkdir(sessionHome);
  const requests: string[] = [];
  let modelCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (url, options) => {
      const request = new Request(url, options);
      if (request.url.endsWith("/v1/models")) {
        return Response.json({ data: [model] });
      }
      requests.push(await request.text());
      modelCalls += 1;
      return new Response(messageEvents(modelCalls), {
        headers: { "content-type": "text/event-stream" },
      });
    })
  );
  const input = {
    agentToken: "private-token",
    appId: sessionId,
    hostUrl: "https://host.test/api/tailorkit",
    messages: [],
    model: modelId,
  };
  const sandboxSession = localSession(workspace, sessionHome);
  let session:
    | Awaited<
        ReturnType<Awaited<ReturnType<typeof createAppAgent>>["createSession"]>
      >
    | undefined;
  try {
    const agent = await createAppAgent(input, "fixture");
    expect(agent.harnessId).toBe("pi");
    session = await agent.createSession({ sandboxSession, sessionId });
    const result = await agent.stream({ prompt: "Build a file", session });
    const chunks: UIMessageChunk[] = [];
    for await (const chunk of toUIMessageStream({
      stream: result.stream,
      tools: agent.tools,
    })) {
      chunks.push(chunk);
    }
    expect(await result.text).toBe("Built");
    expect(chunks).toContainEqual(
      expect.objectContaining({
        input: { content: "First turn", file_path: "example.txt" },
        toolName: "write",
        type: "tool-input-available",
      })
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        toolCallId: "write-1",
        type: "tool-output-available",
      })
    );
    expect(await readFile(join(workspace, "example.txt"), "utf-8")).toBe(
      "First turn"
    );
    const resumeFrom = await session.detach();
    expect(resumeFrom.harnessId).toBe("pi");
    expect(JSON.stringify(resumeFrom.data)).toMatch(/\.jsonl/u);
    session = undefined;
    // A different workflow worker cannot rely on the previous worker's files.
    await rm(hostJournal, { force: true, recursive: true });
    const nextAgent = await createAppAgent(
      { ...input, agentToken: "fresh-token" },
      "fixture"
    );
    session = await nextAgent.createSession({
      resumeFrom,
      sandboxSession,
      sessionId,
    });
    const next = await nextAgent.generate({ prompt: "Now update it", session });
    expect(next.text).toBe("Updated");
    expect(requests).toHaveLength(3);
    expect(requests[2]).toContain("Build a file");
    expect(requests[2]).toContain("Built");
    expect(requests[2]).toContain("Now update it");
  } finally {
    await session?.destroy();
    vi.unstubAllGlobals();
    await rm(directory, { force: true, recursive: true });
    await rm(hostJournal, { force: true, recursive: true });
  }
}, 30_000);
