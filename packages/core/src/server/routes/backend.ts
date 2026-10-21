import { openapi } from "@orpc/openapi";
import { appsRuntimeSession } from "@patchsmith/client-platform/client";
import * as v from "valibot";

import { httpOutput, httpPolicy } from "#server/http";
import { platformAppSelector } from "#server/platform-app-selector";
import { o, requireHostAuth } from "#server/procedures";

export const backendSession = o
  .meta(
    openapi({
      method: "POST",
      outputStructure: "detailed",
      path: "/backend/session",
    }),
    httpPolicy({ authenticate: true, json: true, maxBodyBytes: 4096 })
  )
  .use(requireHostAuth)
  .input(
    v.strictObject({
      appId: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
    })
  )
  .handler(async ({ context, input }) => {
    const session = await appsRuntimeSession({
      body: {
        app: platformAppSelector(input.appId),
        scopes: Object.entries(context.patchsmith.scopes).map(
          ([name, value]) => ({ name, value })
        ),
        subjectId: context.patchsmith.subjectId,
        toolUrl: context.toolUrl,
      },
      client: context.platform,
      headers: context.platformHeaders,
      responseStyle: "fields",
      throwOnError: false,
    });

    if (session.data) {
      return { body: session.data };
    }

    return httpOutput(
      Response.json(
        session.error ?? { error: "Unable to authorize the app backend" },
        { status: session.response?.status ?? 502 }
      ),
      context
    );
  });
