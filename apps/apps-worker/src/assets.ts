import {
  AssetDeliveryError,
  assetHeaders,
  acceptsGzip,
  assetResponse,
  assetSize,
  hostedAssetRequest,
  limitAssetBody,
  serveAssetRequest,
} from "@tailorkit/asset-delivery";
import type { AssetIdentity } from "@tailorkit/asset-delivery";
import { Effect } from "effect";

function downstreamResponse(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  // Keep browser reuse bounded when a deployment is removed.
  headers.set("Cache-Control", "private, max-age=3600");
  let { body } = response;
  if (headers.get("Content-Encoding") === "gzip" && !acceptsGzip(request)) {
    headers.delete("Content-Encoding");
    headers.delete("Content-Length");
    if (headers.has("ETag")) {
      headers.set("ETag", `W/${headers.get("ETag")}`);
    }
    if (request.method !== "HEAD" && body) {
      body = limitAssetBody(body.pipeThrough(new DecompressionStream("gzip")));
    }
  }
  return new Response(request.method === "HEAD" ? null : body, {
    encodeBody: "manual",
    headers,
    status: response.status,
  });
}

function loadAsset(
  request: Request,
  identity: AssetIdentity,
  env: Env,
  ctx: ExecutionContext
) {
  return Effect.gen(function* () {
    // Node/DOM ambient types omit Cloudflare's default edge cache.
    const edgeCache = caches as CacheStorage & { readonly default: Cache };
    // Cache the stored representation, then negotiate for each downstream request.
    const cacheKey = new Request(request.url, {
      headers: { "Accept-Encoding": "gzip" },
    });
    const cached = yield* Effect.tryPromise(() =>
      edgeCache.default.match(cacheKey)
    ).pipe(Effect.catch(() => Effect.succeed()));
    if (cached) {
      return downstreamResponse(cached, request);
    }

    if (request.method === "HEAD") {
      const object = yield* Effect.tryPromise({
        catch: () => new AssetDeliveryError(503),
        try: () => env.BUNDLES.head(identity.key),
      });
      const contentLength = yield* assetSize(object?.size);
      return downstreamResponse(
        new Response(null, {
          headers: assetHeaders({
            contentEncoding: object?.httpMetadata?.contentEncoding,
            contentLength,
            contentType: identity.contentType,
            etag: object?.httpEtag,
          }),
        }),
        request
      );
    }

    const object = yield* Effect.tryPromise({
      catch: () => new AssetDeliveryError(503),
      try: () => env.BUNDLES.get(identity.key),
    });
    const contentLength = yield* assetSize(object?.size);
    if (!object) {
      return yield* Effect.fail(new AssetDeliveryError(404));
    }
    const response = new Response(object.body, {
      encodeBody: "manual",
      headers: assetHeaders({
        contentEncoding: object.httpMetadata?.contentEncoding,
        contentLength,
        contentType: identity.contentType,
        etag: object.httpEtag,
      }),
    });
    // workerd clones reset encodeBody; keep cached bytes compressed exactly once.
    const cacheWrite = Effect.tryPromise(() =>
      edgeCache.default.put(
        cacheKey,
        new Response(response.clone().body, {
          encodeBody: "manual",
          headers: response.headers,
        })
      )
    ).pipe(
      Effect.catch(() =>
        Effect.sync(() => {
          console.error(
            JSON.stringify({ message: "Asset cache write failed" })
          );
        })
      )
    );
    yield* Effect.sync(() => ctx.waitUntil(Effect.runPromise(cacheWrite)));
    return downstreamResponse(response, request);
  });
}

export default {
  fetch(request, env, ctx) {
    const program = serveAssetRequest(request, {
      identity: hostedAssetRequest(request, env.ASSET_DOMAIN),
      load: (identity) => loadAsset(request, identity, env, ctx),
    });
    return Effect.runPromise(
      assetResponse(program, () => {
        console.error(
          JSON.stringify({
            hostname: new URL(request.url).hostname,
            message: "Asset delivery failed",
          })
        );
      })
    );
  },
} satisfies ExportedHandler<Env>;
