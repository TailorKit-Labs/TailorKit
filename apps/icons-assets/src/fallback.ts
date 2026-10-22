// Existing assets bypass this handler. Keep misses out of the immutable cache.
export default {
  fetch: (request: Request): Response => {
    const headers = {
      "Access-Control-Allow-Methods": "GET, HEAD",
      "Access-Control-Allow-Origin": "*",
      Allow: "GET, HEAD",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    };

    const status =
      request.method === "GET" || request.method === "HEAD" ? 404 : 405;

    return new Response(null, { headers, status });
  },
};
