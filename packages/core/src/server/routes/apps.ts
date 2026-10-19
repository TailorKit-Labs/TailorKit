import {
  appsCreate,
  appsDelete,
  appsDeploy,
  appsGet,
  appsList,
  appsUpdate,
} from "@patchsmith/client-platform/client";
import * as v from "valibot";

import { platformAppSelector } from "#server/platform-app-selector";
import {
  getPatchSmithScope,
  getPatchSmithScopes,
  o,
  requireCliDeployToken,
} from "#server/procedures";

const paginationInput = v.object({
  page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  pageSize: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100))
  ),
});

const appInput = v.object({
  description: v.nullable(v.string()),
  name: v.string(),
  slug: v.optional(v.string()),
});

export const appRouter = {
  create: o
    .use(requireCliDeployToken)
    .input(v.strictObject(appInput.entries))
    .handler(async ({ context, input }) => {
      const { data } = await appsCreate({
        body: { ...input, scope: getPatchSmithScope(context) },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        throwOnError: true,
      });
      return data;
    }),
  delete: o
    .use(requireCliDeployToken)
    .input(v.object({ appId: v.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDelete({
          body: {
            app: platformAppSelector(input.appId),
            scope: getPatchSmithScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
  deploy: o
    .use(requireCliDeployToken)
    .input(v.object({ appId: v.string(), deploymentId: v.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDeploy({
          body: {
            app: platformAppSelector(input.appId),
            deploymentId: input.deploymentId,
            scope: getPatchSmithScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
  get: o
    .use(requireCliDeployToken)
    .input(
      v.object({ appId: v.string(), scopes: v.optional(v.array(v.string())) })
    )
    .handler(async ({ context, input }) => {
      const { data } = await appsGet({
        body: {
          app: platformAppSelector(input.appId),
          scopes: getPatchSmithScopes(context, input.scopes),
        },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        throwOnError: true,
      });
      return data;
    }),
  list: o
    .use(requireCliDeployToken)
    .input(
      v.optional(
        v.object({
          ...paginationInput.entries,
          scopes: v.optional(v.array(v.string())),
        })
      )
    )
    .handler(async ({ context, input }) => {
      const { data } = await appsList({
        body: {
          page: input?.page,
          pageSize: input?.pageSize,
          scopes: getPatchSmithScopes(context, input?.scopes),
        },
        client: context.platform,
        headers: context.platformHeaders,
        responseStyle: "fields",
        throwOnError: true,
      });
      return data;
    }),
  update: o
    .use(requireCliDeployToken)
    .input(
      v.strictObject({
        appId: v.string(),
        ...v.omit(appInput, ["slug"]).entries,
      })
    )
    .handler(
      async ({ context, input }) =>
        await appsUpdate({
          body: {
            app: platformAppSelector(input.appId),
            description: input.description,
            name: input.name,
            scope: getPatchSmithScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
        })
    ),
};
