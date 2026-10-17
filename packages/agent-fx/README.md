# @tailorkit/agent-fx

The default app builder for chat and MCP. Uses the stock `@ai-sdk/harness-fx` adapter, native tools and session persistence, with TailorKit instructions, two skills, and one host-side deployment tool.

fx runs on the host. File and shell tools run in a persistent Vercel Sandbox; source is stored on the app's shared Drive. fx handles scaffolding through the TailorKit CLI. Deployment credentials stay on the host.

Each model step runs in a durable Workflow step. Finished turns save fx's resume state and stop the sandbox. Failed or cancelled turns invalidate the thread and remove its sandbox while preserving source. A database lease prevents concurrent app writers. Start a new thread to switch an existing Pi conversation to fx.

No runtime code is imported from `@tailorkit/agent`; the Pi package is unchanged. Configure `AI_GATEWAY_API_KEY` or Vercel OIDC on the host, with optional `AI_GATEWAY_BASE_URL`.
