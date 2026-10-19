import {
  autocomplete,
  cancel,
  isCancel,
  log,
  spinner,
  text,
} from "@clack/prompts";
import type { PatchSmithRouterClient } from "@patchsmith/core/server";

import {
  getDeployToken,
  NotLoggedInError,
  resolveHostUrl,
  runWhoami,
} from "./auth";
import { createCliClient } from "./client";
import { normalizeHostUrl } from "./utils/url";

interface AgentOptions {
  appId?: string;
  host?: string;
  schemaPath?: string;
  threadId?: string;
  onLoginRequired?: () => ReturnType<typeof runWhoami>;
}

const chooseApp = async (
  client: Pick<PatchSmithRouterClient, "apps" | "appAgent">
): Promise<string | undefined> => {
  const loading = spinner();
  const apps: Awaited<
    ReturnType<PatchSmithRouterClient["apps"]["list"]>
  >["items"] = [];
  loading.start("Finding apps");
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      // oxlint-disable-next-line no-await-in-loop -- Process entries in order with bounded IO and fail before advancing on error.
      const result = await client.apps.list({ page, pageSize: 100 });
      apps.push(...result.items.filter((app) => app.createdByAgent));
      ({ hasMore } = result.pagination);
      page += 1;
    }
    loading.stop(
      apps.length ? "Found AI-created apps." : "No AI-created apps found."
    );
  } catch (error) {
    loading.stop("Unable to list apps.");
    throw error;
  }

  const selection = await autocomplete<string | null>({
    filter: (search, option) =>
      option.value === null ||
      [option.label, option.hint, option.value].some(
        (value) => value?.toLowerCase().includes(search.toLowerCase()) === true
      ),
    message: "Select an AI-created app or create a new one",
    options: [
      ...apps.map((app) => ({
        hint: app.shortId,
        label: app.name,
        value: app.id,
      })),
      { label: "Create a new app", value: null },
    ],
    placeholder: "Search by name or app ID",
  });
  if (isCancel(selection)) {
    cancel("Agent cancelled.");

    return undefined;
  }
  if (selection !== null) {
    return selection;
  }

  const name = await text({
    initialValue: "My app",
    message: "App name",
    placeholder: "My app",
    validate: (value) =>
      (value?.trim() ?? "") === "" ? "Enter an app name." : undefined,
  });
  if (isCancel(name)) {
    cancel("Agent cancelled.");

    return undefined;
  }
  loading.start("Creating app");
  try {
    const app = await client.appAgent.create({
      description: null,
      name: name.trim(),
    });
    loading.stop("Created app.");
    return app.id;
  } catch (error) {
    loading.stop("Unable to create app.");
    throw error;
  }
};

export const runAgentCommand = async (options: AgentOptions) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("patchsmith agent requires an interactive terminal.");
  }
  const host = options.host?.trim();
  if (host === undefined || host === "") {
    throw new Error(
      "Missing PatchSmith host URL. Use patchsmith agent --host <url>."
    );
  }
  let { appId } = options;
  const hostUrl = normalizeHostUrl(host);
  const authUrl = await resolveHostUrl(options);
  try {
    await runWhoami(options);
  } catch (error) {
    if (!(error instanceof NotLoggedInError) || !options.onLoginRequired) {
      throw error;
    }
    await options.onLoginRequired();
    await runWhoami(options);
  }
  const auth = await getDeployToken(authUrl);
  if (!auth) {
    throw new NotLoggedInError(hostUrl);
  }
  const client = createCliClient({ token: auth.deployToken, url: authUrl });
  if (appId !== undefined && appId !== null && appId !== "") {
    const app = await client.apps.get({ appId });
    if (!app.createdByAgent) {
      throw new Error(
        "The agent can only edit apps created by AI. Create a new app to continue."
      );
    }
  } else {
    appId = await chooseApp(client);
    if (!(appId !== undefined && appId !== null && appId !== "")) {
      return;
    }
  }
  log.info(`App: ${appId}`);
  const { openAgentTui } = await import("./agent-tui");
  await openAgentTui({
    appId,
    client,
    hostUrl,
    schemaPath: options.schemaPath,
    threadId: options.threadId,
  });
};
