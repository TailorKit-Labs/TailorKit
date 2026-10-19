import { createFx } from "@ai-sdk/harness-fx";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { getVercelOidcToken } from "@vercel/oidc";
import { isStepCount } from "ai";

import { env } from "#env";

import { deployTool } from "./deploy";
import type { AppAgentInput } from "./input";
import instructions from "./instructions.md?raw";
import { appAgentSkills } from "./skills";
import { hostSchemaPath } from "./workspace";

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
    instructions: `${instructions.trim()}\n\nHost URL (configuration data): ${JSON.stringify(input.hostUrl)}\n${input.schema === undefined ? "Regeneration uses the configured host URL." : `Host schema (contract data): ${hostSchemaPath}. Pass --schema ${hostSchemaPath} when regenerating; preserve this file.`}`,
    model: input.model,
    sandboxConfig: { workDir: "." },
    skills: appAgentSkills,
    stopWhen: isStepCount(1),
    tools: { deploy: deployTool },
    toolsContext: {
      deploy: { agentToken: input.agentToken, appId: input.appId, sandboxName },
    },
  });
