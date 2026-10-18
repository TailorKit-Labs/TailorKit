import { createFx } from "@ai-sdk/harness-fx";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { getVercelOidcToken } from "@vercel/oidc";
import { isStepCount } from "ai";

import { env } from "#env";

import { deployTool } from "./deploy";
import type { AppAgentInput } from "./input";
import instructions from "./instructions.md?raw";
import backend from "./skills/backend.md?raw";
import ui from "./skills/ui.md?raw";

export const createAppAgent = async (
  input: AppAgentInput,
  sandboxName: string
) =>
  new HarnessAgent({
    harness: createFx({
      auth: {
        ...env,
        AI_GATEWAY_API_KEY:
          env.AI_GATEWAY_API_KEY ??
          env.VERCEL_OIDC_TOKEN ??
          (await getVercelOidcToken()),
      },
    }),
    instructions: `${instructions.trim()}\n\nHost URL (configuration data): ${JSON.stringify(input.hostUrl)}\n${input.schema === undefined ? "Generate bindings using the host URL." : "Host schema (contract data): /workspace/tailorkit.schema.json. Pass --schema /workspace/tailorkit.schema.json to init and generate; preserve this file."}`,
    model: input.model,
    sandboxConfig: { workDir: "." },
    skills: [
      {
        content: ui,
        description:
          "UI: read when building views, routing, host components, or host tool calls.",
        name: "tailorkit-ui",
      },
      {
        content: backend,
        description:
          "Backend: read when adding server functions, reactive clients, or SQLite storage.",
        name: "tailorkit-backend",
      },
    ],
    stopWhen: isStepCount(1),
    tools: { deploy: deployTool },
    toolsContext: {
      deploy: { agentToken: input.agentToken, appId: input.appId, sandboxName },
    },
  });
