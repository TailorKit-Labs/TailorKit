import { existsSync, readFileSync } from "node:fs";
import nodePath from "node:path";

import { parse } from "dotenv";
import * as z from "zod";

const { dirname, resolve } = nodePath;

type EnvFields = NonNullable<Parameters<typeof z.object>[0]>;

const reportedWarnings = new Set<string>();

const findWorkspaceRoot = (startDirectory: string): string | undefined => {
  let directory = startDirectory;

  while (true) {
    if (existsSync(resolve(directory, "pnpm-workspace.yaml"))) {
      return directory;
    }

    const parentDirectory = dirname(directory);

    if (parentDirectory === directory) {
      return undefined;
    }

    directory = parentDirectory;
  }
};

const readEnvironment = (): NodeJS.ProcessEnv => {
  const workspaceRoot = findWorkspaceRoot(process.cwd()) ?? process.cwd();
  const webRoot = resolve(workspaceRoot, "apps/web");

  const dotenvFiles = [
    resolve(workspaceRoot, ".env"),
    resolve(webRoot, ".env"),
    resolve(workspaceRoot, ".env.local"),
    resolve(webRoot, ".env.local"),
  ];

  const fileValues: Record<string, string> = {};

  for (const filePath of new Set(dotenvFiles)) {
    if (existsSync(filePath)) {
      Object.assign(fileValues, parse(readFileSync(filePath)));
    }
  }

  // Platform and shell variables take precedence over local dotenv files.
  return { ...fileValues, ...process.env };
};

const warn = (scope: string, message: string): void => {
  const key = `${scope}:${message}`;

  if (reportedWarnings.has(key)) {
    return;
  }

  reportedWarnings.add(key);
  console.warn(`[env:${scope}] ${message}`);
};

export const createEnv = <const T extends EnvFields>({
  scope,
  schema: environmentFields,
  warnings = {},
  values,
}: {
  scope: string;
  schema: T;
  /** Explicit Worker bindings bypass process.env and local dotenv files. */
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Native Worker bindings enter through this I/O boundary and each declared field is parsed by its own validator below.
  values?: Readonly<Record<string, unknown>>;
  warnings?: Partial<Record<keyof T & string, string>>;
}): Partial<z.output<z.ZodObject<T>>> => {
  const source = values ?? readEnvironment();

  const missingWarnings = new Map<string, string | undefined>(
    Object.entries(warnings)
  );

  const parsedEntries: [string, unknown][] = [];

  for (const [name, validator] of Object.entries(environmentFields)) {
    const rawValue = source[name] === "" ? undefined : source[name];
    const parsed = z.safeParse(validator, rawValue);

    const missingWarning = missingWarnings.get(name);

    if (
      rawValue === undefined &&
      missingWarning !== undefined &&
      missingWarning !== null &&
      missingWarning !== ""
    ) {
      warn(scope, missingWarning);
    }

    if (!parsed.success) {
      if (rawValue !== undefined) {
        const issueMessages = parsed.error.issues
          .map((issue) => issue.message)
          .join(", ");

        warn(scope, `Invalid ${name}: ${issueMessages}`);
      }

      continue;
    }

    if (parsed.data !== undefined) {
      parsedEntries.push([name, parsed.data]);
    }
  }

  // SAFETY: Only declared fields with successful results from their own Zod validator are inserted; missing or invalid fields are omitted.
  return (
    /* oxlint-disable typescript/no-unsafe-type-assertion -- Only declared fields with successful results from their own Zod validator are inserted; missing or invalid fields are omitted. */
    Object.fromEntries(parsedEntries) as Partial<z.output<z.ZodObject<T>>>
    /* oxlint-enable typescript/no-unsafe-type-assertion */
  );
};

// oxlint-disable-next-line anti-slop/no-object-parameters -- This structural adapter enumerates caller-owned fields; a concrete domain shape would exclude supported schema or attribute objects.
export const warnIfMissing = (scope: string, values: object): void => {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === "") {
      warn(
        scope,
        `Missing ${name}. Add it to a local .env file or the deployment environment.`
      );
    }
  }
};

export const resolveProductionUrl = (values: {
  AUTH_PRODUCTION_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}): string | undefined => {
  let value = values.AUTH_PRODUCTION_URL;

  if (
    !(value !== undefined && value !== null && value !== "") &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== undefined &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== null &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== ""
  ) {
    value = `https://${values.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (!(value !== undefined && value !== null && value !== "")) {
    return undefined;
  }

  if (!URL.canParse(value)) {
    return undefined;
  }

  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return undefined;
  }

  return url.href.replace(/\/$/u, "");
};

export const getProductionUrl = (values: {
  AUTH_PRODUCTION_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
}) => resolveProductionUrl(values);

export const getBaseUrl = (values: {
  PORT?: number;
  VERCEL_ENV?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
}): string => {
  if (
    values.VERCEL_ENV === "production" &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== undefined &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== null &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== ""
  ) {
    return `https://${values.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (
    values.VERCEL_ENV === "preview" &&
    values.VERCEL_URL !== undefined &&
    values.VERCEL_URL !== null &&
    values.VERCEL_URL !== ""
  ) {
    return `https://${values.VERCEL_URL}`;
  }

  return `http://localhost:${values.PORT ?? 3000}`;
};

export const getTrustedOrigins = (values: {
  AUTH_TRUSTED_ORIGINS?: string;
  PORT?: number;
  VERCEL_ENV?: string;
  VERCEL_BRANCH_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
}): string[] => {
  const origins = new Set([getBaseUrl(values)]);

  for (const origin of values.AUTH_TRUSTED_ORIGINS?.split(",") ?? []) {
    const trimmedOrigin = origin.trim().replace(/\/$/u, "");

    if (trimmedOrigin) {
      origins.add(trimmedOrigin);
    }
  }

  if (
    values.VERCEL_ENV === "production" &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== undefined &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== null &&
    values.VERCEL_PROJECT_PRODUCTION_URL !== ""
  ) {
    origins.add(`https://${values.VERCEL_PROJECT_PRODUCTION_URL}`);
  }

  if (values.VERCEL_ENV === "preview") {
    if (
      values.VERCEL_BRANCH_URL !== undefined &&
      values.VERCEL_BRANCH_URL !== null &&
      values.VERCEL_BRANCH_URL !== ""
    ) {
      origins.add(`https://${values.VERCEL_BRANCH_URL}`);
    }

    if (
      values.VERCEL_URL !== undefined &&
      values.VERCEL_URL !== null &&
      values.VERCEL_URL !== ""
    ) {
      origins.add(`https://${values.VERCEL_URL}`);
    }
  }

  return [...origins];
};
