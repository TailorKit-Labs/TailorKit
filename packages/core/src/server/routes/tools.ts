import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { appsGet } from "@patchsmith/client-platform/client";
import { createClient } from "@patchsmith/client-platform/client/client/index";
import * as v from "valibot";

import type { PatchsmithContract } from "#schema/contract";
import type { ToolContext, ToolImplementationTree } from "#schema/tools";
import { flattenTools, validateToolValue } from "#schema/tools";
import type { Context } from "#server/context";
import { httpOutput, httpPolicy } from "#server/http";
import { o } from "#server/procedures";
import { normalizePatchsmithNamedScope } from "#server/scope";
import { createToolVerifier } from "#server/tool-auth";
import type {
  PatchsmithPlatformOptions,
  ToolExecutionInput,
} from "#server/types";

const isFunctionValue = <TValue>(
  value: TValue
): value is Extract<TValue, CallableFunction> => typeof value === "function";

const isToolHandler = (
  value: ToolImplementationTree[string]
): value is Exclude<ToolImplementationTree[string], ToolImplementationTree> =>
  typeof value === "function";

export const getImplementation = (
  tree: ToolImplementationTree | undefined,
  path: string
): ToolImplementationTree[string] | undefined => {
  let value: ToolImplementationTree[string] | undefined = tree;

  for (const name of path.split(".")) {
    if (!value || isToolHandler(value) || !Object.hasOwn(value, name)) {
      return undefined;
    }

    value = value[name];
  }

  return value;
};

interface ToolExecutorOptions {
  contract: PatchsmithContract;
  tools?: ToolImplementationTree;
  platformUrl: string;
  platformHeaders?: PatchsmithPlatformOptions["headers"];
  requestPlatform: typeof fetch;
  toolUrl: string;
}

export const createToolExecutor = (options: ToolExecutorOptions) => {
  const declarations = flattenTools(options.contract.tools);

  const {
    platformUrl,
    requestPlatform,
    platformHeaders,
    toolUrl,
    contract,
    tools,
  } = options;

  const platform = createClient({
    baseUrl: platformUrl,
    fetch: requestPlatform,
    responseStyle: "data",
    throwOnError: true,
  });

  const verify = createToolVerifier({ fetch: requestPlatform, platformUrl });

  const authenticateTool = async (
    request: Request,
    requestId: string
  ): Promise<ToolContext> => {
    const authorization = request.headers.get("authorization");

    if (!(authorization?.startsWith("Bearer ") === true)) {
      throw new Error("Invalid credential.");
    }

    const identity = await verify(authorization.slice(7), toolUrl);

    const schema = contract.scopes[identity.scope.name];

    if (!schema) {
      throw new Error("Invalid credential.");
    }

    await validateToolValue(schema, identity.scope.value);

    const headersValue = await (isFunctionValue(platformHeaders)
      ? platformHeaders()
      : platformHeaders);

    const installation = await appsGet({
      body: {
        app: { id: identity.installationId },
        scopes: [normalizePatchsmithNamedScope(identity.scope)],
      },
      client: platform,
      headers: headersValue,
      throwOnError: true,
    });

    const installed = "data" in installation ? installation.data : installation;

    if (
      installed.id !== identity.installationId ||
      installed.projectId !== identity.projectId ||
      installed.currentDeployment?.id !== identity.deploymentId
    ) {
      throw new Error("Installation unavailable");
    }

    return Object.freeze({
      identity,
      requestId,
      scope: identity.scope,
    });
  };

  return async (
    request: Request,
    input: ToolExecutionInput
  ): Promise<Response> => {
    const headers = {
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    };

    const declaration = declarations.get(input.path);

    if (declaration?.kind !== "server") {
      return new Response("Tool not found", { headers, status: 404 });
    }

    let context: ToolContext;

    try {
      context = await authenticateTool(request, input.requestId);
    } catch {
      return new Response("Unauthorized", { headers, status: 401 });
    }

    let value;

    try {
      value = await validateToolValue(
        declaration.definition.input,
        input.input
      );
    } catch {
      return new Response("Invalid tool input", {
        headers,
        status: 400,
      });
    }

    try {
      const implementation = getImplementation(tools, input.path);

      if (!isFunctionValue(implementation)) {
        throw new Error("Tool implementation unavailable");
      }

      // SAFETY: This registered path owns the declaration that validated value above; the heterogeneous tree erases only its specific input type.
      const toolInput =
        /* oxlint-disable typescript/no-unsafe-type-assertion -- This registered path owns the declaration that validated value above; the heterogeneous tree erases only its specific input type. */
        value as never;

      /* oxlint-enable typescript/no-unsafe-type-assertion */
      const result = await validateToolValue(
        declaration.definition.output,
        await implementation({ context, input: toolInput })
      );

      return Response.json({ output: result }, { headers });
    } catch {
      return new Response("Tool execution failed", {
        headers,
        status: 500,
      });
    }
  };
};

const execute = async (context: Context, input: ToolExecutionInput) => {
  if (!context.toolExecutor) {
    throw new ORPCError("NOT_FOUND", { message: "Tool not found" });
  }

  return httpOutput(
    await context.toolExecutor(context.request, input),
    context
  );
};

export const toolsRouter = {
  execute: o
    .meta(
      openapi({
        method: "POST",
        outputStructure: "detailed",
        path: "/tools/execute",
      }),
      httpPolicy({ cors: true, invalidInputMessage: "Invalid tool request" })
    )
    .input(
      v.strictObject({
        input: v.optional(v.unknown()),
        path: v.string(),
        requestId: v.pipe(v.string(), v.regex(/^[0-9a-f-]{36}$/u)),
      })
    )
    .handler(async ({ context, input }) => await execute(context, input)),
};
