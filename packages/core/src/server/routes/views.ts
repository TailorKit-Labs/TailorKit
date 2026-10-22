import { openapi } from "@orpc/openapi";
import { ORPCError, RPCJsonSerializer } from "@orpc/server";
import { appsRuntimeResolve } from "@patchsmith/client-platform/client";
import * as v from "valibot";

import type { PatchsmithSchema } from "#schema/schema";
import { httpPolicy, recordHttpTiming } from "#server/http";
import { listApps } from "#server/list-apps";
import { o, requireHostAuth } from "#server/procedures";
import { selectPatchsmithScopes } from "#server/scope";
import {
  composeViewContext,
  getViewHierarchy,
  viewsInputSchema,
  viewsResultSchema,
} from "#views";
import type { ViewLayer, ViewContextValues } from "#views";

const contextSerializer = new RPCJsonSerializer();

const serializeContext = async (context: ViewContextValues) => {
  const serialized = contextSerializer.serialize(context);

  const blobs =
    serialized.blobs === undefined
      ? undefined
      : await Promise.all(
          serialized.blobs.map(async (blob) => {
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let binary = "";

            for (let offset = 0; offset < bytes.length; offset += 8192) {
              binary += String.fromCodePoint(
                ...bytes.subarray(offset, offset + 8192)
              );
            }

            return {
              data: btoa(binary),
              lastModified:
                blob instanceof File ? blob.lastModified : undefined,
              name: blob instanceof File ? blob.name : undefined,
              type: blob.type,
            };
          })
        );

  return {
    context: v.parse(v.record(v.string(), v.unknown()), serialized.json),
    contextBlobs: blobs,
    contextMaps: serialized.maps,
    contextMeta: serialized.meta?.map(([type, ...path]) => ({ path, type })),
  };
};

const validateLayers = async (
  schema: PatchsmithSchema,
  paths: Set<string>,
  layers: ViewLayer[]
) =>
  await Promise.all(
    layers.map(async (layer): Promise<ViewLayer> => {
      const validator = Object.entries(schema.views).find(
        ([path]) => path === layer.path
      )?.[1];

      if (!paths.has(layer.path) || layer.status !== "ready" || !validator) {
        return layer;
      }

      try {
        const parsed = await validator["~standard"].validate(layer.context);

        return parsed.issues
          ? { path: layer.path, status: "error" }
          : { ...layer, context: parsed.value };
      } catch {
        return { path: layer.path, status: "error" };
      }
    })
  );

/** The host authenticates and validates context; the platform owns app-backend fan-out. */
export const views = o
  .meta(
    openapi({ method: "POST", path: "/views" }),
    httpPolicy({ authTiming: "views_auth", authenticate: true, json: true })
  )
  .use(requireHostAuth)
  .input(viewsInputSchema)
  .output(viewsResultSchema)
  .handler(async ({ context, input }) => {
    const { request, schema } = context;
    const viewer = context.patchsmith;
    let scopes;

    try {
      scopes =
        input.scopes?.length === 0
          ? []
          : selectPatchsmithScopes(viewer.scopes, input.scopes);
    } catch {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid views request" });
    }

    const definition = schema.slots[input.slot];

    if (!definition || !scopes.length || input.appIds?.length === 0) {
      return { data: [], status: "ready" };
    }

    try {
      request.signal.throwIfAborted();

      if (definition.multiple !== true) {
        const started = performance.now();
        const apps = await listApps(context, scopes, request.signal);
        recordHttpTiming(context, "views_discovery", started);

        return {
          data: apps
            .filter(
              (app) =>
                input.appIds === undefined || input.appIds.includes(app.id)
            )
            .filter((app) =>
              app.views?.some(
                (view) =>
                  view.slot === input.slot &&
                  !view.disabled &&
                  !view.instances &&
                  definition.views.includes(view.path)
              )
            )
            .map((app) => ({ app })),
          status: "ready",
        };
      }

      const active = input.activeView;

      if (!active) {
        return { status: "idle" };
      }

      const paths = getViewHierarchy(active.view).filter((path) =>
        definition.views.includes(path)
      );

      const layers = await validateLayers(
        schema,
        new Set(paths.flatMap(getViewHierarchy)),
        active.layers
      );

      const contexts = await Promise.all(
        paths.map(async (path) => {
          try {
            const props = composeViewContext(path, {
              declaredViews: Object.keys(schema.views),
              layers,
            });

            if (props.status !== "ready") {
              return { path, status: props.status };
            }

            return {
              ...(await serializeContext(props.context)),
              path,
              status: props.status,
            };
          } catch {
            // The platform rejects errors only for views actually selected by an installation.
            return { path, status: "error" as const };
          }
        })
      );

      const started = performance.now();

      const { data, response } = await appsRuntimeResolve({
        body: {
          appIds: input.appIds === undefined ? undefined : [...input.appIds],
          contexts,
          scopes,
          slot: input.slot,
          subjectId: viewer.subjectId,
          toolUrl: context.toolUrl,
        },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        signal: request.signal,
        throwOnError: false,
      });

      recordHttpTiming(context, "views_platform", started);

      if (!response) {
        throw new ORPCError("BAD_GATEWAY", {
          message: "Unable to resolve views",
        });
      }

      const timing = response.headers.get("server-timing");

      if (timing !== null) {
        context.resHeaders?.append("server-timing", timing);
      }

      if (response.status === 400) {
        throw new ORPCError("BAD_REQUEST", { message: "Invalid view context" });
      }

      if (!response.ok || !data) {
        throw new ORPCError("BAD_GATEWAY", {
          message: "Unable to resolve views",
        });
      }

      return data;
    } catch (error) {
      if (error instanceof ORPCError) {
        throw error;
      }

      throw new ORPCError("BAD_GATEWAY", {
        message: "Unable to resolve views",
      });
    }
  });
