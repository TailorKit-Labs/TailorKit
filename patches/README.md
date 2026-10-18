# fx checkpoint replay

`@ai-sdk/harness-fx@1.0.69` advances its emitted-event cursors before the harness consumes those events. The harness reads one event beyond a `finish-step` boundary when evaluating `stopWhen`. Suspending there loses that event: fx suppresses it on replay even though it never reached the UI stream.

For consecutive tool calls, the next tool result arrives without its input. `readUIMessageStream` throws `No tool invocation found for tool call ID`, and the MCP handler cancels the workflow and deletes its sandbox. The still-running fx cleanup then reports `Vercel Sandbox not found`, obscuring the stream failure.

The patch implements the harness's existing `sandboxChannelEventCheckpoint` protocol in fx. Each step boundary captures the display cursors. If that boundary is pinned during suspension, fx rewinds those cursors after stopping the runtime and before saving continuation state. Recorded responses and tool outcomes stay intact; completed commands are replayed from their records rather than executed again.

The integration test in `packages/agent-fx/src/agent.integration.test.ts` consumes the real harness output with the AI SDK UI stream reader. It covers consecutive file/shell tools, cloned workflow checkpoints, complete text output, exactly one shell execution, and the next user turn under all three authentication modes.

The patch includes the changed TypeScript source and regenerated JavaScript and source map. Regenerate with Vite+ Pack using `src/index.ts`, ESM, target `node22`, source maps, `define: { __PACKAGE_VERSION__: '"1.0.69"' }`, and `outputOptions: { entryFileNames: '[name].js' }`; leave package dependencies external and preserve the existing declarations. Commit with `pnpm patch-commit`.

Remove this patch when an upstream fx release passes the regression test without it. The checkpoint symbol is an internal harness protocol, so recheck compatibility when upgrading either package.
