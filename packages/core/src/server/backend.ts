import type { TailorKitScopes } from "./types";

// Keep the request/build lifecycle and its failure paths together.
// eslint-disable-next-line complexity
export const handleBackendSession = async (
  request: Request,
  authenticate: (input: {
    request: Request;
  }) => Promise<{ scopes: TailorKitScopes; subjectId?: string } | null>,
  issueSession: (
    appId: string,
    scopes: TailorKitScopes,
    subjectId?: string
  ) => Promise<{ token: string; expiresAt: number; url: string } | Response>,
  publicOrigin = new URL(request.url).origin
) => {
  const headers = { "cache-control": "no-store" };
  const origin = request.headers.get("origin");
  if (
    request.method !== "POST" ||
    !request.headers.get("content-type")?.startsWith("application/json") ||
    (origin && origin !== publicOrigin)
  ) {
    return new Response("Invalid request", { headers, status: 400 });
  }
  const viewer = await authenticate({ request });
  if (!viewer) {
    return new Response("Unauthorized", { headers, status: 401 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 4096) {
    return new Response("Too large", { headers, status: 413 });
  }
  // Bound chunked bodies too; a sandbox cannot allocate an unbounded host request.
  const reader = request.body?.getReader();
  let body = "";
  if (reader) {
    const decoder = new TextDecoder();
    let bytes = 0;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 4096) {
        // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
        await reader.cancel();
        return new Response("Too large", { headers, status: 413 });
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  }
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { headers, status: 400 });
  }
  if (
    !input ||
    typeof input !== "object" ||
    !("appId" in input) ||
    typeof input.appId !== "string" ||
    !input.appId ||
    input.appId.length > 256 ||
    Object.keys(input).length !== 1
  ) {
    return new Response("Invalid app", { headers, status: 400 });
  }
  const session = await issueSession(
    input.appId,
    viewer.scopes,
    viewer.subjectId
  );
  if (session instanceof Response) {
    const responseHeaders = new Headers(session.headers);
    responseHeaders.set("cache-control", "no-store");
    return new Response(session.body, {
      headers: responseHeaders,
      status: session.status,
    });
  }
  return Response.json(
    { ...session, subjectId: viewer.subjectId },
    { headers }
  );
};
