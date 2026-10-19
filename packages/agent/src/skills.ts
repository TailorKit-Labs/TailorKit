import type { HarnessAgentSkill } from "@ai-sdk/harness/agent";

import functions from "./skills/backend-functions.md?raw";
import hostUi from "./skills/host-ui.md?raw";
import composition from "./skills/preact-composition.md?raw";
import performance from "./skills/preact-performance.md?raw";
import draftExample from "./skills/references/drafts.md?raw";
import localStateExample from "./skills/references/local-state.md?raw";
import database from "./skills/sqlite-database.md?raw";
import routing from "./skills/views-and-routing.md?raw";

/** Bundled with the agent; the harness makes each skill discoverable on demand. */
export const appAgentSkills = [
  {
    content: hostUi,
    description: "Frontend: components, forms, callbacks, or product tools.",
    files: [{ content: draftExample, path: "references/drafts.md" }],
    name: "tailorkit-frontend",
  },
  {
    content: routing,
    description: "Views: slots, context, layouts, or repeated instances.",
    name: "tailorkit-views-and-routing",
  },
  {
    content: functions,
    description:
      "Functions: queries, mutations, actions, or reactive client hooks.",
    name: "tailorkit-backend-functions",
  },
  {
    content: database,
    description: "Database: tables, relations, reads/writes, or migrations.",
    name: "tailorkit-sqlite-database",
  },
  {
    content: composition,
    description: "Composition: simplify repeated components or shared state.",
    files: [{ content: localStateExample, path: "references/local-state.md" }],
    name: "tailorkit-preact-composition",
  },
  {
    content: performance,
    description: "Performance: diagnose slow interactions or excessive work.",
    name: "tailorkit-preact-performance",
  },
] satisfies readonly HarnessAgentSkill[];
