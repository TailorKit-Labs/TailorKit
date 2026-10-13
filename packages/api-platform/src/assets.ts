import {
  AssetDeliveryError,
  assetHeaders,
  assetResponse,
  assetSize,
  limitAssetBody,
  nodeAssetRequest,
  serveAssetRequest,
} from "@tailorkit/asset-delivery";
import type { AssetIdentity } from "@tailorkit/asset-delivery";
import type { Storage } from "@tailorkit/storage";
import { Effect } from "effect";

const storageFailure = (error: unknown) => {
  if (error && typeof error === "object") {
    const value = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    if (
      value.name === "NoSuchKey" ||
      value.name === "NotFound" ||
      value.$metadata?.httpStatusCode === 404
    ) {
      return new AssetDeliveryError(404);
    }
  }
  return new AssetDeliveryError(503);
};

const loadAsset = (
  request: Request,
  identity: AssetIdentity,
  storage: Storage
) =>
  Effect.gen(function* loadAssetValue() {
    const { key } = identity;
    const object = yield* Effect.tryPromise({
      catch: storageFailure,
      try: () => storage.head({ key }),
    });
    const contentLength = yield* assetSize(object.contentLength);
    const headers = assetHeaders({
      contentLength,
      contentType: identity.contentType,
      etag: object.etag,
    });
    // Node fetch decodes Content-Encoding automatically. The local adapter serves
    // that decoded stream; the stored length and strong ETag describe gzip bytes.
    if (object.contentEncoding === "gzip") {
      headers.delete("Content-Length");
      if (object.etag) {
        headers.set("ETag", `W/${object.etag}`);
      }
    }
    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }
    const download = yield* Effect.tryPromise({
      catch: storageFailure,
      try: () => storage.createDownloadUrl({ expiresInSeconds: 60, key }),
    });
    const upstream = yield* Effect.tryPromise({
      catch: storageFailure,
      try: (signal) => fetch(download.url, { redirect: "error", signal }),
    });
    if (!upstream.ok) {
      return yield* Effect.fail(
        new AssetDeliveryError(upstream.status === 404 ? 404 : 503)
      );
    }
    const body =
      object.contentEncoding === "gzip" && upstream.body
        ? limitAssetBody(upstream.body)
        : upstream.body;
    return new Response(body, { headers });
  });

export const handleAssetRequest = (
  request: Request,
  storage: Storage | null
): Promise<Response> => {
  const program = Effect.gen(function* program() {
    const identity = yield* nodeAssetRequest(request);
    if (!storage) {
      return yield* Effect.fail(new AssetDeliveryError(503));
    }
    return yield* serveAssetRequest(request, {
      identity: Effect.succeed(identity),
      load: (asset) => loadAsset(request, asset, storage),
    });
  });
  return Effect.runPromise(assetResponse(program));
};
