---
"@patchsmith/client-core": patch
"@patchsmith/core": patch
---

Keep slot discovery stable when context changes below the slot's deepest supported view. Retain all relevant ancestor context, filters, and explicit refresh behavior while avoiding repeated instance resolution for unrelated child views.

Expose aggregate Server-Timing durations for host authentication, platform discovery, and instance resolution on views responses, without including app identifiers or credentials.

Register the host HTTP endpoints under server/routes as oRPC procedures and serve their existing URLs through the OpenAPI transport. Centralize request policy, scoped authentication, bounded backend-session JSON, timing headers and tool preflight handling. Preserve the CLI RPC protocol and HTML approval flow. Unsupported HTTP methods now fall through to the normal 404 response.

Reject serialized tool requests larger than 1 MiB before JSON decoding or signature verification, including streamed request bodies.
