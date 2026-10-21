import type { ViewInstance } from "@patchsmith/app/client";
import { createClient, reference } from "@patchsmith/app/client/connection";
import * as v from "valibot";

import type { PatchsmithSchema } from "#schema/schema";
import {
  composeViewContext,
  getViewHierarchy,
  selectSlotView,
  viewsInputSchema,
} from "#views";
import type { ViewsResult, ViewLayer, ViewContextValues } from "#views";

import type { Context } from "./context";
import { discoverViewApps } from "./runtime-discovery";
import { selectPatchsmithScopes } from "./scope";

const resolver = reference<
  "action",
  { slot: string; path: string; context: ViewContextValues },
  ViewInstance[]
>("_patchsmith.instances.resolve", "action");

const validateLayers = async (
  schema: PatchsmithSchema,
  paths: Set<string>,
  layers: ViewLayer[]
) =>
  await Promise.all(
    layers.map(async (layer) => {
      const validator = Object.entries(schema.views).find(
        ([path]) => path === layer.path
      )?.[1];

      if (!paths.has(layer.path) || layer.status !== "ready" || !validator) {
        return layer;
      }

      const parsed = await validator["~standard"].validate(layer.context);

      if (parsed.issues) {
        throw new Error(`Invalid context for view "${layer.path}".`);
      }

      return { ...layer, context: parsed.value };
    })
  );

const isViewsRequest = (request: Request, publicOrigin: string): boolean => {
  const origin = request.headers.get("origin");

  return !(
    request.method !== "POST" ||
    request.headers.get("content-type")?.startsWith("application/json") !==
      true ||
    (origin !== null && origin !== "" && origin !== publicOrigin)
  );
};

/** Discover authorized installations and run their generated instance actions on the host. */
export const handleViews = async (
  context: Context,
  publicOrigin: string,
  toolUrl: string
): Promise<Response> => {
  const { request, schema } = context;
  const headers = new Headers({ "cache-control": "no-store" });

  const recordTiming = (stage: string, started: number) => {
    headers.append(
      "server-timing",
      `${stage};dur=${(performance.now() - started).toFixed(1)}`
    );
  };

  if (!isViewsRequest(request, publicOrigin)) {
    return new Response("Invalid request", { headers, status: 400 });
  }

  const authenticationStarted = performance.now();
  const viewer = await context.authenticate({ request });
  recordTiming("views_auth", authenticationStarted);

  if (!viewer) {
    return new Response("Unauthorized", { headers, status: 401 });
  }

  let input;
  let scopes;

  try {
    input = v.parse(viewsInputSchema, await request.json());
    scopes =
      input.scopes?.length === 0
        ? []
        : selectPatchsmithScopes(viewer.scopes, input.scopes);
  } catch {
    return new Response("Invalid views request", { headers, status: 400 });
  }

  const definition = schema.slots[input.slot];

  if (!definition || !scopes.length || input.appIds?.length === 0) {
    return Response.json({ data: [], status: "ready" }, { headers });
  }

  if (definition.multiple === true && input.activeView === null) {
    return Response.json({ status: "idle" }, { headers });
  }

  const controller = new AbortController();

  const abort = () => {
    controller.abort();
  };

  request.signal.addEventListener("abort", abort, { once: true });

  try {
    request.signal.throwIfAborted();

    const discoveryStarted = performance.now();

    const { apps: discovered, sessions } = await discoverViewApps(
      context,
      input,
      definition,
      viewer,
      scopes,
      toolUrl,
      controller.signal
    );

    recordTiming("views_discovery", discoveryStarted);

    const apps = discovered.filter(
      (app) => input.appIds === undefined || input.appIds.includes(app.id)
    );

    if (definition.multiple !== true) {
      return Response.json(
        {
          data: apps
            .values()
            .filter((app) =>
              app.views?.some(
                (view) =>
                  view.slot === input.slot &&
                  !view.disabled &&
                  !view.instances &&
                  definition.views.includes(view.path)
              )
            )
            .map((app) => ({ app }))
            .toArray(),
          status: "ready",
        },
        { headers }
      );
    }

    const active = input.activeView;

    if (!active) {
      return Response.json({ status: "idle" }, { headers });
    }

    const matches = apps.flatMap((app) => {
      const view = selectSlotView(
        app.views ?? [],
        input.slot,
        active.view,
        schema
      );

      return view?.instances ? [{ app, view }] : [];
    });

    const paths = new Set(
      matches.flatMap(({ view }) => getViewHierarchy(view.path))
    );

    let layers;

    try {
      layers = await validateLayers(schema, paths, active.layers);
    } catch {
      return new Response("Invalid view context", { headers, status: 400 });
    }

    const resolved = matches.map(({ app, view }) => ({
      app,
      props: composeViewContext(view.path, {
        declaredViews: Object.keys(schema.views),
        layers,
      }),
    }));

    if (resolved.some(({ props }) => props.status === "error")) {
      return new Response("View context is unavailable", {
        headers,
        status: 400,
      });
    }

    if (resolved.some(({ props }) => props.status === "loading")) {
      return Response.json({ status: "loading" }, { headers });
    }

    const instancesStarted = performance.now();

    const data = await Promise.all(
      resolved.map(async ({ app, props }) => {
        if (props.status !== "ready") {
          return [];
        }

        const backend = createClient({
          // oxlint-disable-next-line require-await -- The async provider returns this request's already authorized session without I/O.
          getSession: async () => {
            const session = sessions.get(app.id);

            if (!session) {
              throw new Error("Missing discovered runtime session");
            }

            return session;
          },
        });

        const close = () => {
          backend.close();
        };

        controller.signal.addEventListener("abort", close, { once: true });

        try {
          controller.signal.throwIfAborted();

          const instances = await backend.action(resolver, {
            context: props.context,
            path: props.view,
            slot: input.slot,
          });

          return instances.map((instance) => ({ ...instance, app }));
        } finally {
          controller.signal.removeEventListener("abort", close);
          backend.close();
        }
      })
    );

    recordTiming("views_instances", instancesStarted);

    const result: ViewsResult = { data: data.flat(), status: "ready" };

    return Response.json(result, { headers });
  } catch {
    controller.abort();

    return new Response("Unable to resolve views", { headers, status: 502 });
  } finally {
    request.signal.removeEventListener("abort", abort);
  }
};
