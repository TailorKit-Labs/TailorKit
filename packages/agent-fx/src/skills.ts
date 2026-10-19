import type { HarnessAgentSkill } from "@ai-sdk/harness/agent";

import database from "./skills/database.md?raw";
import frontend from "./skills/frontend.md?raw";
import functions from "./skills/functions.md?raw";
import functionExamples from "./skills/references/functions.md?raw";
import interactionExamples from "./skills/references/interactions.md?raw";
import viewExamples from "./skills/references/views.md?raw";
import workflowExamples from "./skills/references/workflows.md?raw";
import setup from "./skills/setup.md?raw";
import views from "./skills/views.md?raw";

export const appAgentReferencesDirectory =
  "/workspace/.tailorkit-agent/references";
export const appAgentReferences = [
  {
    content: workflowExamples,
    path: `${appAgentReferencesDirectory}/workflows.md`,
  },
  {
    content: interactionExamples,
    path: `${appAgentReferencesDirectory}/interactions.md`,
  },
  { content: viewExamples, path: `${appAgentReferencesDirectory}/views.md` },
  {
    content: functionExamples,
    path: `${appAgentReferencesDirectory}/functions.md`,
  },
];

// The fx adapter embeds HarnessAgentSkill.files in the initial prompt. Link to
// provisioned sandbox files so recipes are read only when their branch applies.
const withReferencePaths = (content: string) =>
  content.replaceAll("](references/", `](${appAgentReferencesDirectory}/`);

export const appAgentSkills = [
  {
    content: withReferencePaths(setup),
    description:
      "Setup: choosing workflow/data ownership, scaffolding, configuration, dependency installation, generated bindings, SDK lookup, or build/deployment failures.",
    name: "tailorkit-setup",
  },
  {
    content: withReferencePaths(frontend),
    description:
      "Frontend: UI, forms, serialized callbacks, product tool calls, shared state, accessibility, or bridge responsiveness.",
    name: "tailorkit-frontend",
  },
  {
    content: withReferencePaths(views),
    description:
      "Views: slots, record context, shared shells/layouts, or repeated instances and their resolvers.",
    name: "tailorkit-views",
  },
  {
    content: withReferencePaths(functions),
    description:
      "Functions: reactive queries, atomic mutations, external actions, access checks, or client hooks.",
    name: "tailorkit-functions",
  },
  {
    content: database,
    description:
      "Database: tailorkit/db tables, typed inserts, relations, database queries, or migrations of existing data.",
    name: "tailorkit-database",
  },
] satisfies readonly HarnessAgentSkill[];
