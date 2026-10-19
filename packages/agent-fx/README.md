# @tailorkit/agent-fx

The default app builder for chat and MCP. Uses the stock `@ai-sdk/harness-fx` adapter, native tools and session persistence, with TailorKit instructions, five app-building skills, and one host-side deployment tool.

fx runs on the host. File and shell tools run in a persistent Vercel Sandbox; source is stored on the app's shared Drive. fx handles scaffolding through the TailorKit CLI. Deployment credentials stay on the host.

Each model step runs in a durable Workflow step. Finished turns save fx's resume state and stop the sandbox. Failed or cancelled turns invalidate the thread and remove its sandbox while preserving source. A database lease prevents concurrent app writers. Start a new thread to switch an existing Pi conversation to fx.

No runtime code is imported from `@tailorkit/agent`. Configure `AI_GATEWAY_API_KEY` or Vercel OIDC on the host, with optional `AI_GATEWAY_BASE_URL`.

## Workflow logs

The fx workflow emits JSON runtime logs for run start/completion/failure, each start/agent/finish/cancel step attempt, and agent checkpoints. Entries include `runId`, `appId`, `threadId` when available, and step `stepId`/`attempt` metadata inside durable steps. Finished and failed attempts include `durationMs`. A failed attempt may retry; `run_failed` means orchestration reached its failure cleanup. `cleanup_failed` records cleanup errors separately. Direct API cancellation logs the run and app IDs without step metadata.

On Vercel, open the workflow run details and choose **View Logs**. Vercel's Logs tab supports Workflow Run ID and Workflow Step ID filters across the run's requests ([Vercel announcement](https://vercel.com/changelog/logs-filtering-for-vercel-workflows-now-available)). Locally, these entries appear in the server console.

Step logs run inside durable steps, so replaying completed checkpoints does not emit them again. Retries emit another attempt. Orchestration failure messages can repeat while cleanup is retried. Prompts, model/tool output, schemas, credentials, resume state, and raw error messages/stacks are omitted. Use the Workflow run inspector for detailed errors and the SDK's authoritative run status, including external cancellation or runtime failures that bypass workflow cleanup.

## Instructions, skills, and examples

`src/instructions.md` favors the smallest working app and routes tasks to the five skills registered in `src/skills.ts`. App-specific UI, callback, styling, view, and tool contracts come from the CLI-generated `.agents/skills/tailorkit-capabilities/` skill in the app workspace.

Small workflow, form, function, and view examples live in `src/skills/references/`. Sandbox preparation refreshes them under `/workspace/.tailorkit-agent/references/`, and the bundled skills link to those files. Keep recipes out of `HarnessAgentSkill.files`: the current fx adapter puts those resources into the initial model prompt. Integration tests verify that example bodies remain outside that prompt.

The CLI's `agent-examples.test.ts` compiles complete marked recipes and generated code examples against public SDK declarations. When adding a complete source file, use an `<!-- example: src/path.tsx -->` marker immediately before its TypeScript fence and include the recipe in that test. Partial snippets should state their required surrounding context.
