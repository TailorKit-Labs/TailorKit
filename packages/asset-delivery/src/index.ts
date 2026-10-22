import { Effect } from "effect";
import { catch as catchEffect } from "effect/Effect";

import type { LogoContentType } from "./logo-validation";

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("Expected a defined value.");
  }

  return value;
};

const shortId = "[0-9a-z]{12}";
const shortIdPattern = /^[0-9a-z]{12}$/u;

const deploymentAssetPath = new RegExp(
  `^/a/(${shortId})/d/(${shortId})/(?:client/(client\\.js)|logos/([a-f0-9]{64}\\.(?:svg|png|webp)))$`,
  "u"
);

const nodeAssetPath = new RegExp(`^/api/assets/p/(${shortId})(/a/.*)$`, "u");
const methods = new Set(["GET", "HEAD", "OPTIONS"]);

export const maxDeploymentBytes = 3 * 1024 * 1024;
export const maxAssetBytes = maxDeploymentBytes;

export interface AssetIdentity {
  appShortId: string;
  deploymentShortId: string;
  projectShortId: string;
  key: string;
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
  projectShortId: string,
  pathname: string
): AssetIdentity | undefined => {
  if (!shortIdPattern.test(projectShortId)) {
    return undefined;
  }

  const match = deploymentAssetPath.exec(pathname);

  if (!match) {
    return undefined;
  }

  const [, appMatch, deploymentMatch, clientFilename, logoFilename] = match;
  const appShortId = requireValue(appMatch);
  const deploymentShortId = requireValue(deploymentMatch);
  const filename = requireValue(clientFilename ?? logoFilename);
  const appKey = `projects/${projectShortId}/apps/${appShortId}`;

  return {
    appShortId,
    contentType: getAssetContentType(filename),
    deploymentShortId,
    key:
      clientFilename === undefined
        ? `${appKey}/logos/${filename}`
        : `${appKey}/deployments/${deploymentShortId}/client/${filename}`,
    projectShortId,
  };
};

const hostedProjectId = (url: URL, assetDomain: string): string | undefined => {
  const suffix = `.${assetDomain}`;

  if (url.protocol !== "https:" || url.port || !url.hostname.endsWith(suffix)) {
    return undefined;
  }

  const projectShortId = url.hostname.slice(0, -suffix.length);

  return shortIdPattern.test(projectShortId) ? projectShortId : undefined;
};

export const parseHostedAssetRequest = (
  request: Request,
  assetDomain: string
): AssetIdentity | undefined => {
  const url = new URL(request.url);
  const projectShortId = hostedProjectId(url, assetDomain);

  if (projectShortId === undefined || url.search) {
    return undefined;
  }

  return createIdentity(projectShortId, url.pathname);
};

export const parseNodeAssetRequest = (
  request: Request
): AssetIdentity | undefined => {
  const url = new URL(request.url);
  const match = nodeAssetPath.exec(url.pathname);

  if (!match || url.search) {
    return undefined;
  }

  return createIdentity(requireValue(match[1]), requireValue(match[2]));
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

/** Hosted app routes share the project's asset origin; local routes include its short ID. */
const hostedAppPath = new RegExp(`^/a/(${shortId})(/rpc(?:/.*)?)$`, "u");
const localAppPath = new RegExp(`^/p/(${shortId})(/a/.*)$`, "u");
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const publicationPath = new RegExp(
  `^/p/(${uuid})/a/(${shortId})/new-deployment$`,
  "u"
);

export const parseHostedAppRoute = (
  request: Request,
  assetDomain: string
):
  | { appShortId: string; projectShortId: string; rpcPath: string }
  | undefined => {
  const url = new URL(request.url);

  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);

  const localMatch = local ? localAppPath.exec(url.pathname) : null;

  const projectShortId = local
    ? localMatch?.[1]
    : hostedProjectId(url, assetDomain);

  const pathname = local ? localMatch?.[2] : url.pathname;

  if (projectShortId === undefined || pathname === undefined) {
    return undefined;
  }

  const match = hostedAppPath.exec(pathname);

  if (!match) {
    return undefined;
  }

  return {
    appShortId: requireValue(match[1]),
    projectShortId,
    rpcPath: requireValue(match[2]),
  };
};

/** Metadata publication is restricted to the authenticated internal hostname. */
export const parseDeploymentPublicationRoute = (
  request: Request,
  assetDomain: string
): { appShortId: string; projectId: string } | undefined => {
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
    appShortId: requireValue(match[2]),
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
    catchEffect((failure) =>
      Effect.sync(() => {
        if (failure.status === 503) {
          onUnavailable?.();
        }

        return assetFailure(failure.status);
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
