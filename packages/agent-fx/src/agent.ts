import { createFx } from "@ai-sdk/harness-fx";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import { getVercelOidcToken } from "@vercel/oidc";
import { isStepCount } from "ai";

import { env } from "#env";

import { deployTool } from "./deploy";
import type { AppAgentInput } from "./input";
import instructions from "./instructions.md?raw";
import database from "./skills/database.md?raw";
import frontend from "./skills/frontend.md?raw";
import functions from "./skills/functions.md?raw";
import setup from "./skills/setup.md?raw";
import views from "./skills/views.md?raw";

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
        content: setup,
        description:
          "Setup: read when scaffolding an app, configuring its host or backend, generating bindings, locating SDK types, or fixing build/deployment failures.",
        name: "tailorkit-setup",
      },
      {
        content: frontend,
        description:
          "Frontend: read when building UI, forms, callbacks, component composition, state, accessibility, or performance across the async host bridge.",
        name: "tailorkit-frontend",
      },
      {
        content: views,
        description:
          "Views: read when choosing slots and context paths, adding roots/layouts, or supplying repeated view instances.",
        name: "tailorkit-views",
      },
      {
        content: functions,
        description:
          "Functions: read when implementing queries, mutations, actions, backend host tool calls, authorization, or reactive client hooks.",
        name: "tailorkit-functions",
      },
      {
        content: database,
        description:
          "Database: read when defining SQLite tables/relations, writing database queries, or generating and upgrading migrations.",
        name: "tailorkit-database",
      },
    ],
    stopWhen: isStepCount(1),
    tools: { deploy: deployTool },
    toolsContext: {
      deploy: { agentToken: input.agentToken, appId: input.appId, sandboxName },
    },
  });
