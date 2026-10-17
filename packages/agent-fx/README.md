# TailorKit fx agent

`@tailorkit/agent-fx` runs the stock [fx harness adapter](https://ai-sdk.dev/providers/ai-sdk-harnesses/fx) with TailorKit instructions, skills, and the host-executed `deploy` tool. New platform chat and MCP conversations use this package. Existing Pi conversations continue with Pi when resumed.

## Runtime and capabilities

libfx runs in the host process. Its native `read`, `write`, `edit`, `bash`, `grep`, `glob`, and `ls` tools operate through the Vercel sandbox session. There is no sandbox bridge, executable installation, or exposed port. The adapter chooses its backend and reasoning defaults; the package adds no model catalog overrides or custom file tools.

`@tailorkit/agent/runtime` supplies the same app instructions, six skills, generated-contract guidance, and host-side deployment tool as Pi. fx's stock skills adapter includes the supplied skill content in its instructions. File tools are scoped to `/workspace/app`; sandbox bash can read the supplied schema and CLI types outside that directory.

Workspace scaffolding, shared app source Drives, thread authorization, editing leases, sandbox lifetime management, source export, cancellation, and publication reuse `@tailorkit/agent`. Deployment credentials stay in the host tool context and never enter the sandbox shell or model instructions.

## Durable turns

`@tailorkit/agent-fx/workflows` exports `appAgent(input)`. The web host registers it in `apps/web/workflows/app-agent.ts`; chat and MCP start this same workflow.

Each model step uses `runHarnessAgentStep()` with `isStepCount(1)`. The workflow continues an unfinished turn from `continueFrom`, then stores `resumeFrom` for the next user turn. fx checkpoints live in the sandbox's private home directory, outside the app source Drive. The same thread VM survives step boundaries and is snapshotted and stopped after a successful turn. The existing 30-minute turn budget and app-wide writer lease remain in effect.

Saved state identifies its harness. Pi threads keep their Pi adapter and journal; new threads receive fx state. Conversations are never converted between harnesses. Both share the current app source, and cancellation invalidates only its owning conversation.

## Authentication and dependencies

Configure `AI_GATEWAY_API_KEY` or Vercel OIDC on the platform. Each workflow slice resolves request-scoped OIDC again; `AI_GATEWAY_API_KEY` takes precedence. `AI_GATEWAY_BASE_URL` is optional. fx supports Gateway authentication; direct OpenAI/Anthropic keys and local fx subscription credentials are not used.

The web build externalizes libfx from both Workflow and Vite/Nitro bundles, then traces the complete package so its native addons remain beside its JavaScript entry points. The web workspace declares the matching libfx version for that trace.

The native libfx adapter and isolated authentication record require the pinned SDK releases in this PR. Older fx adapters use ACP. `pnpm-workspace.yaml` records exact release-age exceptions for those releases and the compatible harness/workflow SDK dependencies.

## Verification

Run `pnpm exec turbo run check-types test --filter=@tailorkit/agent-fx --filter=@tailorkit/agent --filter=@tailorkit/api-platform --filter=web` and `pnpm check` from the repository root.

The integration test runs real libfx against a disposable local filesystem/shell and a deterministic Gateway transport fixture. It verifies API-key and runtime OIDC authentication, native file writes, shared skills and deploy registration, typed UI chunks, workflow checkpoints, and follow-up history. Linux provides the GNU utilities the production sandbox requires; macOS tests use Homebrew coreutils when installed.
