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
    description:
      "Frontend: read when building app UI, choosing generated components or styling props, handling callbacks, or calling host tools.",
    files: [{ content: draftExample, path: "references/drafts.md" }],
    name: "tailorkit-frontend",
  },
  {
    content: routing,
    description:
      "Routing: read when adding or changing views, layouts, host context, or repeated slot instances.",
    name: "tailorkit-views-and-routing",
  },
  {
    content: functions,
    description:
      "Functions: read when adding backend queries, mutations, external-call actions, or client subscriptions.",
    name: "tailorkit-backend-functions",
  },
  {
    content: database,
    description:
      "Database: read when changing SQLite tables, Drizzle relations, database reads/writes, or migrations.",
    name: "tailorkit-sqlite-database",
  },
  {
    content: composition,
    description:
      "Composition: read when building reusable Preact components, variants, or shared state providers.",
    files: [{ content: localStateExample, path: "references/local-state.md" }],
    name: "tailorkit-preact-composition",
  },
  {
    content: performance,
    description:
      "Performance: read when fixing excessive renders, duplicate subscriptions, async waterfalls, or large client bundles.",
    name: "tailorkit-preact-performance",
  },
] satisfies readonly HarnessAgentSkill[];
