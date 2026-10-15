const iconAssetPath =
  /^\/lucide\/1\.55\.0\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\.json|LICENSE\.txt)$/u;

/** Only the reserved catalogue origin exposes the static icon assets. */
export const serveIcon = async (
  request: Request,
  env: { ASSET_DOMAIN: string; ICON_ASSETS: Pick<Fetcher, "fetch"> }
): Promise<Response | undefined> => {
  const url = new URL(request.url);
  if (url.hostname !== `icons.${env.ASSET_DOMAIN}`) {
    return undefined;
  }
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (!iconAssetPath.test(url.pathname) || url.search) {
    return new Response(null, { headers, status: 404 });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { headers, status: 204 });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    headers.set("Allow", "GET, HEAD, OPTIONS");
    return new Response(null, { headers, status: 405 });
  }
  const response = await env.ICON_ASSETS.fetch(request);
  if (response.status !== 200) {
    return new Response(null, { headers, status: response.status });
  }
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set(
    "Content-Type",
    url.pathname.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "text/plain; charset=utf-8"
  );
  return new Response(request.method === "HEAD" ? null : response.body, {
    headers,
  });
};
