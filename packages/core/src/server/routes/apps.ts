import {
  appsCreate,
  appsDelete,
  appsDeploy,
  appsGet,
  appsList,
  appsUpdate,
} from "@tailorkit/client-platform/client";
import * as v from "valibot";

import {
  getTailorKitScope,
  getTailorKitScopes,
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
});

export const appRouter = {
  create: o
    .use(requireCliDeployToken)
    .input(v.strictObject(appInput.entries))
    .handler(async ({ context, input }) => {
      const { data } = await appsCreate({
        body: { ...input, scope: getTailorKitScope(context) },
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
          body: { scope: getTailorKitScope(context) },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        })
    ),
  deploy: o
    .use(requireCliDeployToken)
    .input(v.object({ appId: v.string(), deploymentId: v.string() }))
    .handler(
      async ({ context, input }) =>
        await appsDeploy({
          body: {
            deploymentId: input.deploymentId,
            scope: getTailorKitScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        })
    ),
  get: o
    .use(requireCliDeployToken)
    .input(
      v.object({ appId: v.string(), scopes: v.optional(v.array(v.string())) })
    )
    .handler(async ({ context, input }) => {
      const { data } = await appsGet({
        body: { scopes: getTailorKitScopes(context, input.scopes) },
        client: context.platform,
        headers: context.platformHeaders,
        path: { appId: input.appId },
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
          scopes: getTailorKitScopes(context, input?.scopes),
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
      v.object({
        ...v.object({ appId: v.string() }).entries,
        ...appInput.entries,
      })
    )
    .handler(
      async ({ context, input }) =>
        await appsUpdate({
          body: {
            description: input.description,
            name: input.name,
            scope: getTailorKitScope(context),
          },
          client: context.platform,
          headers: context.platformHeaders,
          path: { appId: input.appId },
        })
    ),
};
