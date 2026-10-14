import { Effect } from "effect";
import { catch as catchEffect } from "effect/Effect";

import type { LogoContentType } from "./logo-validation";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }
  return value;
};

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const publicId = "[0-9a-z]{10}(?:[0-9a-z]{2})?";
const deploymentAssetPath = new RegExp(
  `^/p/(${uuid})/a/(${publicId})/d/(${publicId})/(?:client/(client\\.js)|logos/([a-f0-9]{64}\\.(?:svg|png|webp)))$`,
  "u"
);
const teamIdPattern = /^[a-z0-9][a-z0-9-]{12}[a-z0-9]$/u;
const nodeAssetPath = /^\/api\/assets\/t\/(?<team>[^/]+)(?<path>\/p\/.*)$/u;
const methods = new Set(["GET", "HEAD", "OPTIONS"]);

export const maxDeploymentBytes = 3 * 1024 * 1024;
export const maxAssetBytes = maxDeploymentBytes;

export interface AssetIdentity {
  appId: string;
  deploymentId: string;
  key: string;
  projectId: string;
  publicTeamId: string;
  contentType: "application/javascript" | LogoContentType;
}

const getAssetContentType = (
  filename: string
): AssetIdentity["contentType"] => {
  if (filename.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filename.endsWith(".png")) {
    return "image/png";
  }
  if (filename.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/javascript";
};

const createIdentity = (
  publicTeamId: string,
  pathname: string
): AssetIdentity | undefined => {
  if (!teamIdPattern.test(publicTeamId)) {
    return undefined;
  }

  const match = deploymentAssetPath.exec(pathname);
  if (!match) {
    return undefined;
  }
  const [, projectId, appId, deploymentId, clientFilename, logoFilename] =
    match;
  const filename = clientFilename ?? logoFilename;
  if (
    !(projectId !== undefined && projectId !== null && projectId !== "") ||
    !(appId !== undefined && appId !== null && appId !== "") ||
    !(
      deploymentId !== undefined &&
      deploymentId !== null &&
      deploymentId !== ""
    ) ||
    !(filename !== undefined && filename !== null && filename !== "")
  ) {
    return undefined;
  }
  const appKey = `teams/${publicTeamId}/projects/${projectId}/apps/${appId}`;
  return {
    appId,
    contentType: getAssetContentType(filename),
    deploymentId,
    key:
      clientFilename !== undefined &&
      clientFilename !== null &&
      clientFilename !== ""
        ? `${appKey}/deployments/${deploymentId}/client/${filename}`
        : `${appKey}/logos/${filename}`,
    projectId,
    publicTeamId,
  };
};

export const parseHostedAssetRequest = (
  request: Request,
  assetDomain: string
): AssetIdentity | undefined => {
  const url = new URL(request.url);
  const suffix = `.${assetDomain}`;
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.search ||
    !url.hostname.endsWith(suffix)
  ) {
    return undefined;
  }
  return createIdentity(url.hostname.slice(0, -suffix.length), url.pathname);
};

export const parseNodeAssetRequest = (
  request: Request
): AssetIdentity | undefined => {
  const url = new URL(request.url);
  if (url.search) {
    return undefined;
  }
  const match = nodeAssetPath.exec(url.pathname);
  if (!match) {
    return undefined;
  }
  const [, publicTeamId, assetPathname] = match;
  if (
    !(
      publicTeamId !== undefined &&
      publicTeamId !== null &&
      publicTeamId !== ""
    ) ||
    !(
      assetPathname !== undefined &&
      assetPathname !== null &&
      assetPathname !== ""
    )
  ) {
    return undefined;
  }
  return createIdentity(publicTeamId, assetPathname);
};

export const isAssetMethod = (method: string): boolean => methods.has(method);

export const isValidAssetSize = (size: number | undefined): size is number =>
  size !== undefined && size >= 1 && size <= maxAssetBytes;

export const assetFailure = (status: number): Response =>
  new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
    status,
  });

export const assetPreflight = (): Response =>
  new Response(null, {
    headers: {
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
    status: 204,
  });

export const assetHeaders = (input: {
  contentLength: number;
  contentEncoding?: string;
  contentType?: AssetIdentity["contentType"];
  etag?: string;
}): Headers => {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
    "Content-Length": String(input.contentLength),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type":
      input.contentType === "application/javascript" ||
      input.contentType === undefined
        ? "application/javascript; charset=utf-8"
        : input.contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  if (input.contentEncoding === "gzip") {
    headers.set("Content-Encoding", "gzip");
    headers.set("Vary", "Accept-Encoding");
  }
  if (input.etag !== undefined && input.etag !== null && input.etag !== "") {
    headers.set("ETag", input.etag);
  }
  return headers;
};

/** Hosted app routes use public team/app IDs and the canonical project UUID. */
const hostedAppPath = new RegExp(
  `^/p/(${uuid})/a/(${publicId})(/rpc(?:/.*)?)$`,
  "u"
);
const publicationPath = new RegExp(
  `^/p/(${uuid})/a/(${publicId})/new-deployment$`,
  "u"
);

export const parseHostedAppRoute = (
  request: Request,
  assetDomain: string
):
  | {
      appPublicId: string;
      projectId: string;
      publicTeamId: string | undefined;
      rpcPath: string;
    }
  | undefined => {
  const url = new URL(request.url);
  const suffix = `.${assetDomain}`;
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    !local &&
    (url.protocol !== "https:" || url.port || !url.hostname.endsWith(suffix))
  ) {
    return undefined;
  }
  const publicTeamId = local
    ? undefined
    : url.hostname.slice(0, -suffix.length);
  if (
    !local &&
    (!(
      publicTeamId !== undefined &&
      publicTeamId !== null &&
      publicTeamId !== ""
    ) ||
      !teamIdPattern.test(publicTeamId))
  ) {
    return undefined;
  }
  const match = hostedAppPath.exec(url.pathname);
  if (!match) {
    return undefined;
  }
  return {
    appPublicId: requireValue(match[2]),
    projectId: requireValue(match[1]),
    publicTeamId,
    rpcPath: requireValue(match[3]),
  };
};

/** Publication uses the reserved internal hostname, never a tenant hostname. */
export const parseDeploymentPublicationRoute = (
  request: Request,
  assetDomain: string
): { appPublicId: string; projectId: string } | undefined => {
  const url = new URL(request.url);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.search ||
    url.hostname !== `internal.${assetDomain}`
  ) {
    return undefined;
  }
  const match = publicationPath.exec(url.pathname);
  if (!match) {
    return undefined;
  }
  return {
    appPublicId: requireValue(match[2]),
    projectId: requireValue(match[1]),
  };
};

export class AssetDeliveryError extends Error {
  readonly _tag = "AssetDeliveryError";
  readonly status: 400 | 404 | 405 | 503;
  constructor(status: 400 | 404 | 405 | 503) {
    super(`Asset delivery failed (${status})`);
    this.name = "AssetDeliveryError";
    this.status = status;
  }
}

/** Bound decoded bytes, including objects that have not passed publication checks. */
export const limitAssetBody = (
  body: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> => {
  let contentLength = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        contentLength += chunk.byteLength;
        if (contentLength > maxAssetBytes) {
          controller.error(new AssetDeliveryError(404));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );
};

export const hostedAssetRequest = (request: Request, assetDomain: string) =>
  Effect.gen(function* hostedAssetRequestValue() {
    if (new URL(request.url).protocol !== "https:") {
      return yield* Effect.fail(new AssetDeliveryError(400));
    }
    const identity = parseHostedAssetRequest(request, assetDomain);
    if (!identity) {
      return yield* Effect.fail(new AssetDeliveryError(404));
    }
    return identity;
  });

export const nodeAssetRequest = (request: Request) =>
  Effect.gen(function* nodeAssetRequestValue() {
    const identity = parseNodeAssetRequest(request);
    if (!identity) {
      return yield* Effect.fail(new AssetDeliveryError(404));
    }
    return identity;
  });

export const assetSize = (size: number | undefined) =>
  Effect.gen(function* assetSizeValue() {
    if (!isValidAssetSize(size)) {
      return yield* Effect.fail(new AssetDeliveryError(404));
    }
    return size;
  });

/** Both delivery adapters share request admission. */
export const serveAssetRequest = (
  request: Request,
  options: {
    identity: Effect.Effect<AssetIdentity, AssetDeliveryError>;
    load: (
      identity: AssetIdentity
    ) => Effect.Effect<Response, AssetDeliveryError>;
  }
): Effect.Effect<Response, AssetDeliveryError> =>
  Effect.gen(function* serveAssetRequestValue() {
    const identity = yield* options.identity;
    if (!isAssetMethod(request.method)) {
      return yield* Effect.fail(new AssetDeliveryError(405));
    }
    if (request.method === "OPTIONS") {
      return assetPreflight();
    }
    return yield* options.load(identity);
  });

/** Storage details stay in trusted infrastructure; public failures expose only a status. */
export const assetResponse = (
  program: Effect.Effect<Response, AssetDeliveryError>,
  onUnavailable?: () => void
): Effect.Effect<Response> =>
  program.pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This is an Effect recovery operator or transport callback, not a Node-style completion callback.
    catchEffect((err) =>
      Effect.sync(() => {
        if (err.status === 503) {
          onUnavailable?.();
        }
        return assetFailure(err.status);
      })
    )
  );

/** An explicit gzip refusal takes precedence over a wildcard. */
export const acceptsGzip = (request: Request): boolean => {
  const encodings = (request.headers.get("Accept-Encoding") ?? "")
    .toLowerCase()
    .split(",")
    .map((entry) => {
      const [name, ...parameters] = entry.split(";").map((part) => part.trim());
      const quality = parameters.find((parameter) =>
        parameter.startsWith("q=")
      );
      return {
        name,
        quality:
          quality !== undefined && quality !== null && quality !== ""
            ? Number(quality.slice(2))
            : 1,
      };
    });
  const encoding =
    encodings.find(({ name }) => name === "gzip") ??
    encodings.find(({ name }) => name === "*");
  return (
    encoding !== undefined && encoding.quality > 0 && encoding.quality <= 1
  );
};
