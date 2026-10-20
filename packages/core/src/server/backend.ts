import type { AppsRuntimeSessionResponses } from "@patchsmith/client-platform/client/types.gen";

import type { PatchsmithScopes } from "./types";

const isObjectValue = <TValue>(value: TValue): value is TValue & object =>
  typeof value === "object" && value !== null;

const isStringValue = <TValue>(value: TValue): value is TValue & string =>
  typeof value === "string";

// Keep the request/build lifecycle and its failure paths together.
// eslint-disable-next-line complexity
export const handleBackendSession = async (
  request: Request,
  authenticate: (input: {
    request: Request;
  }) => Promise<{ scopes: PatchsmithScopes; subjectId: string } | null>,
  issueSession: (
    appId: string,
    scopes: PatchsmithScopes,
    subjectId: string
  ) => Promise<AppsRuntimeSessionResponses[200] | Response>,
  publicOrigin = new URL(request.url).origin
) => {
  const headers = { "cache-control": "no-store" };
  const origin = request.headers.get("origin");

  if (
    request.method !== "POST" ||
    !(
      request.headers.get("content-type")?.startsWith("application/json") ===
      true
    ) ||
    (origin !== undefined &&
      origin !== null &&
      origin !== "" &&
      origin !== publicOrigin)
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
  let body = "";

  if (request.body) {
    const decoder = new TextDecoder();
    let bytes = 0;

    for await (const chunk of request.body) {
      bytes += chunk.byteLength;

      if (bytes > 4096) {
        return new Response("Too large", { headers, status: 413 });
      }

      body += decoder.decode(chunk, { stream: true });
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
    !isObjectValue(input) ||
    !("appId" in input) ||
    !isStringValue(input.appId) ||
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

  return Response.json(session, { headers });
};
