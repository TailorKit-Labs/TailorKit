# TailorKit fx agent

`@tailorkit/agent-fx` uses the stock [fx harness adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/fx) to create, edit, and deploy TailorKit apps. New chat and MCP conversations use fx. Start a new conversation to try it against an existing app; Pi session histories stay separate; choosing a Pi thread returns a request to start a new fx conversation without changing the Pi history.

The agent configures `HarnessAgent` with the requested model, TailorKit instructions and skills, the app working directory, and one host-executed `deploy` tool. Everything else uses fx defaults: its native backend selection, reasoning, filesystem/search/shell tools, and session checkpoints. Model and deployment credentials stay on the host.

`agent-step.ts` connects the existing Vercel sandbox through the shared platform sandbox session and calls `runHarnessAgentStep()`. `isStepCount(1)` preserves a workflow checkpoint per model step. There is no Pi fallback, legacy-token cleanup, or custom file tool in the fx flow. The shared sandbox wrapper sets the app working directory to `/workspace/app`, since the SDK only accepts a working directory relative to its sandbox session.

`workflows.ts` supplies those fx steps to the shared platform app-turn runner. The platform owns app scaffolding, persistent source Drives, authorized threads, editing leases, saved resume handles, and cancellation. Both adapters reuse that app infrastructure instead of copying it into fx. Pi's old snapshot cleanup stays on the Pi path.

Configure `AI_GATEWAY_API_KEY` or Vercel OIDC, with optional `AI_GATEWAY_BASE_URL`. Each step resolves request-scoped OIDC again. The web build externalizes libfx and traces its complete package to preserve native addons. Exact release-age exceptions for the required native adapter/SDK releases live in `pnpm-workspace.yaml`.

Run `pnpm check` and `pnpm exec turbo run check-types test --filter=@tailorkit/agent-fx --filter=@tailorkit/agent --filter=@tailorkit/api-platform --filter=web`. The fx integration tests run real libfx against a disposable filesystem/shell and deterministic Gateway responses, verifying native file tools, skills/deploy registration, per-step continuation, follow-up history, and host-only credentials. macOS needs Homebrew coreutils; the production sandbox supplies GNU tools.
