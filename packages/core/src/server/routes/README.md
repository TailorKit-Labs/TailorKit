# Host routes

Define endpoints here as oRPC procedures and register them in `server/router.ts`.

- `patchsmithRouter` serves the CLI RPC protocol through `RPCHandler`.
- `patchsmithHttpRouter` serves existing browser and runtime HTTP URLs through `OpenAPIHandler`. Use `openapi()` metadata to declare their methods and paths; successful JSON responses keep their plain HTTP shape.
- `handler.ts` constructs the schema, clients and request context, then dispatches to those transports. Do not add endpoint-specific path checks there or in the contract factory.

Protected JSON routes declare `httpPolicy({ authenticate: true, json: true })` and use `requireHostAuth`. The transport checks the origin and authenticates before decoding the body; the middleware supplies the typed authenticated context. Their authentication result is shared within one request. Use `maxBodyBytes` for bounded JSON input, as on backend-session issuance.

Only capability-authenticated tool execution enables permissive CORS. Its metadata also registers the preflight policy. It validates the signed installation identity independently of cookie authentication.

Serialized tool requests are limited to 1 MiB, including the path and request ID. The transport enforces this byte limit before JSON decoding or signature verification, including for streamed bodies without a content length.

The CLI approval page uses detailed HTTP output to retain HTML and redirects. `httpOutput` preserves response headers and streamed bodies, including upstream error responses. JSON procedures should declare their input/output schemas and return domain values.
