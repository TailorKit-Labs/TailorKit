import type {
  AppsInstallResponses,
  ClientOptions as PlatformClientOptions,
} from "@patchsmith/client-platform/client/types.gen";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  ContractTools,
  ComponentDefinitions,
  NoComponentFieldCallbackConflicts,
  ViewContextHierarchy,
  ContextDefinitions,
  SlotDefinitions,
  SchemaSerializer,
  PatchSmithSchema,
} from "#schema/index";
import type { EmptyDefinitionMap } from "#schema/shared";

import type { PatchSmithRouter } from "./router";

type HeaderInput = ConstructorParameters<typeof Headers>[0];

export interface PatchSmithPlatformOptions {
  baseUrl?: PlatformClientOptions["baseUrl"];
  fetch?: typeof fetch;
  headers?: HeaderInput | (() => HeaderInput | Promise<HeaderInput>);
}

export interface PatchSmithServerBaseOptions<
  TScopes extends Record<string, StandardSchemaV1> = Record<
    string,
    StandardSchemaV1
  >,
> {
  /**
   * PatchSmith project key. The host application must read its
   * `PATCHSMITH_PROJECT_KEY` environment variable and pass the value here.
   */
  projectKey?: string;
  /** Standard Schema validators keyed by the names used to identify app scopes. */
  scopes: TScopes;
  /** Convert schemas to JSON Schema for metadata and app type generation. */
  schemaSerializer?: SchemaSerializer;
  /**
   * Required absolute public HTTP(S) URL, including the route prefix.
   * Supplies the trusted origin for backend sessions and server tool calls.
   */
  baseUrl: string | URL;
  /**
   * Configuration for browser-based PatchSmith CLI authentication.
   */
  cliAuth?: {
    /**
     * Root-relative path to the host application's sign-in page.
     *
     * When configured, unauthenticated visitors to the CLI approval page are
     * redirected here with a `returnTo` query parameter that points back to
     * the approval page.
     */
    signInPath: `/${string}`;
  };
  /**
   * Internal PatchSmith implementation options.
   *
   * These options are not covered by semantic versioning and may change or
   * break at any time. Avoid using them in application code. If you need one of
   * these hooks, please open a GitHub issue explaining the problem you are
   * solving so we can find a stable public API.
   *
   * @internal
   */
  $internal?: {
    platformBaseUrl?: PatchSmithPlatformOptions["baseUrl"];
    platformFetch?: typeof fetch;
    platformHeaders?: PatchSmithPlatformOptions["headers"];
  };
}

export interface PatchSmithServerSchemaOptions<
  TComponents extends ComponentDefinitions,
  TViews extends ContextDefinitions,
  TTools extends ContractTools = EmptyDefinitionMap,
> {
  tools?: TTools & ContractTools;
  components: TComponents & NoComponentFieldCallbackConflicts<TComponents>;
  views?: TViews & ViewContextHierarchy<TViews>;
  slots?: SlotDefinitions<keyof TViews & string>;
}

export interface PatchSmithServerInputOptions extends PatchSmithServerBaseOptions {
  slots?: SlotDefinitions;
  tools?: ContractTools;
  components: ComponentDefinitions;
  views?: ContextDefinitions;
}

export type InferPatchSmithServerComponents<
  TOptions extends PatchSmithServerInputOptions,
> = TOptions["components"];

export type InferPatchSmithServerViews<
  TOptions extends PatchSmithServerInputOptions,
> = TOptions extends { views: infer TViews } ? TViews : EmptyDefinitionMap;

/** @deprecated Use InferPatchSmithServerViews instead. */
export type InferPatchSmithServerContexts<
  TOptions extends PatchSmithServerInputOptions,
> = InferPatchSmithServerViews<TOptions>;

export type InferPatchSmithServerTools<
  TOptions extends PatchSmithServerInputOptions,
> = TOptions extends { tools: infer TTools } ? TTools : EmptyDefinitionMap;

export type PatchSmithJsonValue =
  | string
  | number
  | boolean
  | null
  | PatchSmithJsonValue[]
  | { [key: string]: PatchSmithJsonValue };

/** A JSON object that identifies one named app scope. */
export type PatchSmithScope = Record<string, PatchSmithJsonValue>;

export interface PatchSmithNamedScope {
  name: string;
  value: PatchSmithScope;
}

export type PatchSmithScopes = Record<string, PatchSmithScope>;

/** Install a deployed app into exactly one scope declared by the host. */
export interface PatchSmithInstallAppOptions<TScopes = PatchSmithScopes> {
  /** Public app ID or UUID of a deployed app in this project. */
  appId: string;
  scope: {
    [TName in keyof TScopes & string]-?: {
      name: TName;
      value: NonNullable<TScopes[TName]>;
    };
  }[keyof TScopes & string];
}

export type PatchSmithInstalledApp = AppsInstallResponses[200];

export type InferPatchSmithServerScopes<
  TOptions extends PatchSmithServerInputOptions,
> = TOptions extends {
  scopes: infer TSchemas extends Record<string, StandardSchemaV1>;
}
  ? {
      [TName in keyof TSchemas]: Pick<
        {
          [TKey in keyof TSchemas]: StandardSchemaV1.InferInput<TSchemas[TKey]>;
        },
        TName
      > &
        Partial<{
          [TKey in Exclude<keyof TSchemas, TName>]: StandardSchemaV1.InferInput<
            TSchemas[TKey]
          >;
        }>;
    }[keyof TSchemas]
  : EmptyDefinitionMap;

export interface PatchSmithServerOptions<
  TComponents extends ComponentDefinitions,
  TViews extends ContextDefinitions,
  TTools extends ContractTools = EmptyDefinitionMap,
  TScopes extends Record<string, StandardSchemaV1> = Record<
    string,
    StandardSchemaV1
  >,
>
  extends
    PatchSmithServerBaseOptions<TScopes>,
    PatchSmithServerSchemaOptions<TComponents, TViews, TTools> {}

export interface PatchSmithHostContext<TScopes = PatchSmithScopes> {
  scopes: TScopes;
  subjectId?: string;
}
export interface PatchSmithHandlerOptions<TScopes = PatchSmithScopes> {
  authenticate: (ctx: {
    request: Request;
  }) =>
    | PatchSmithHostContext<TScopes>
    | null
    | Promise<PatchSmithHostContext<TScopes> | null>;
}
export type PatchSmithHandlerContext<TScopes = PatchSmithScopes> =
  PatchSmithHostContext<TScopes>;

export interface PatchSmithServer<
  TComponents extends ComponentDefinitions,
  TViews extends ContextDefinitions,
  TTools extends ContractTools = EmptyDefinitionMap,
  TScopes = PatchSmithScopes,
> {
  /** Experimental server APIs may change outside semantic versioning. */
  experimental: {
    /** Create an independent installation pinned to the app's published deployment. */
    installApp: (
      options: PatchSmithInstallAppOptions<TScopes>
    ) => Promise<PatchSmithInstalledApp>;
  };
  /** Prepare direct platform MCP HTTP configuration for a server-side client. */
  mcp: {
    transport: (options: PatchSmithHostContext<TScopes>) => Promise<{
      url: string;
      headers: Record<string, string>;
    }>;
  };
  handler: (
    request: Request,
    options: PatchSmithHandlerOptions<TScopes>
  ) => Response | Promise<Response>;
  /**
   * Internal PatchSmith implementation details.
   *
   * This API is not covered by semantic versioning and may change or break at
   * any time. Avoid depending on it in application code. If you need something
   * exposed here, please open a GitHub issue explaining what you are trying to
   * build so we can design a stable public API for that use case.
   *
   * @internal
   */
  $internal: {
    platformBaseUrl: string;
    router: PatchSmithRouter;
    schema: PatchSmithSchema<TComponents, TViews, TTools>;
  };
}
