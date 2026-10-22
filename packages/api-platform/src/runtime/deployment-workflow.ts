import {
  listRuntimeInstallations,
  warmRuntimeDeployment,
} from "./deployment-steps";
import type { RuntimeRollout } from "./deployment-steps";

export const warmAppDeployment = async (input: RuntimeRollout) => {
  "use workflow";
  let cursor: string | undefined;
  let ids: string[];

  do {
    // oxlint-disable-next-line no-await-in-loop -- Each page depends on the preceding durable cursor.
    ids = await listRuntimeInstallations(input, cursor);

    // Limit each batch to ten active warm-up steps, each independently retryable.
    for (let offset = 0; offset < ids.length; offset += 10) {
      // oxlint-disable-next-line no-await-in-loop -- Await each batch to cap concurrent per-installation warm-ups.
      await Promise.all(
        ids.slice(offset, offset + 10).map(async (id) => {
          await warmRuntimeDeployment(input.projectId, id);
        })
      );
    }

    cursor = ids.at(-1);
  } while (ids.length === 50);
};
