import { runtimeServiceAuthorized } from "@patchsmith/api-utils/app-auth";
import { AppError } from "@patchsmith/app/server";
import { z } from "zod";

import { rpcErrorResponse } from "./transport";

const diagnosticPath = "/diagnostics/installation";
const traceUrl = "https://www.cloudflare.com/cdn-cgi/trace";
const traceColo = /^colo=(?<colo>[A-Z]{3})\r?$/mu;
const coloSchema = z.string().regex(/^[A-Z]{3}$/u);
const placementSchema = z.string().regex(/^(?:local|remote)-[A-Z]{3}$/u);

const diagnosticInput = z.strictObject({
  objectId: z.string().regex(/^[0-9a-f]{64}$/u),
});

export interface InstallationLocation {
  requestId: string;
  objectId: string;
  colo: string;
  source: "outbound-trace";
  probeMs: number;
  installationMs: number;
}

interface DiagnosticOptions {
  assetDomain: string;
  serviceToken: string | undefined;
  installation: (objectId: string) => {
    diagnoseLocation: (requestId: string) => Promise<InstallationLocation>;
  };
}

/** An outgoing request gives an execution-location signal, not a physical-location guarantee. */
export const probeLocation = async (fetcher: typeof fetch = fetch) => {
  try {
    const response = await fetcher(traceUrl, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      throw new Error("Trace unavailable");
    }

    const text = await response.text();

    const colo =
      text.length <= 4096 ? traceColo.exec(text)?.groups?.colo : undefined;

    if (colo === undefined) {
      throw new Error("Trace location missing");
    }

    return colo;
  } catch {
    throw new AppError("UNAVAILABLE", "Location probe unavailable");
  }
};

/** Only the internal service route can ask a supervisor to perform a location probe. */
export const installationDiagnostic = (
  request: Request,
  options: DiagnosticOptions
): Promise<Response> | undefined => {
  const url = new URL(request.url);

  if (
    url.protocol !== "https:" ||
    url.hostname !== `internal.${options.assetDomain}` ||
    url.port ||
    url.search ||
    url.pathname !== diagnosticPath
  ) {
    return undefined;
  }

  return (async () => {
    const requestId = crypto.randomUUID();

    const headers = {
      "cache-control": "no-store",
      "x-patchsmith-request-id": requestId,
    };

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        headers: { ...headers, allow: "POST" },
        status: 405,
      });
    }

    try {
      if (!(await runtimeServiceAuthorized(request, options.serviceToken))) {
        throw new AppError(
          "UNAUTHORIZED",
          "Runtime service credential required"
        );
      }

      const text = await request.text();

      if (text.length > 1024) {
        throw new AppError("BAD_REQUEST", "Diagnostic request too large");
      }

      let input: z.infer<typeof diagnosticInput>;

      try {
        input = diagnosticInput.parse(JSON.parse(text));
      } catch {
        throw new AppError("BAD_REQUEST", "Invalid supervisor identifier");
      }

      const lookupStarted = performance.now();
      const installation = options.installation(input.objectId);
      const lookupMs = performance.now() - lookupStarted;
      const started = performance.now();
      const location = await installation.diagnoseLocation(requestId);
      const roundtripMs = performance.now() - started;

      const result = {
        ...location,
        gateway: {
          ingressColo: coloSchema.safeParse(request.cf?.colo).data ?? null,
          placementHeader:
            placementSchema.safeParse(request.headers.get("cf-placement"))
              .data ?? null,
        },
        timings: {
          lookupMs,
          outsideInstallationMs: Math.max(
            0,
            roundtripMs - location.installationMs
          ),
          roundtripMs,
        },
      };

      console.info("Installation location diagnostic", result);

      return Response.json(result, { headers });
    } catch (error) {
      const response = rpcErrorResponse(error);

      return new Response(response.body, {
        headers: { ...Object.fromEntries(response.headers), ...headers },
        status: response.status,
      });
    }
  })();
};
