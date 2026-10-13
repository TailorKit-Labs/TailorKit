import { os } from "@orpc/server";
import { setSpanAttributes } from "@tailorkit/observability";

import { env } from "#env";

export const devDelayMiddleware = os.middleware(async ({ path, next }) => {
  const start = Date.now();

  if (env.NODE_ENV === "development") {
    // artificial delay in dev 100-500ms
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await (async () => {
      const {
        promise: pendingPromise,
        resolve,
        reject: rejectPending,
      } = Promise.withResolvers();
      try {
        setTimeout(resolve, waitMs);
      } catch (error) {
        rejectPending(error);
      }
      return await pendingPromise;
    })();
  }

  // oxlint-disable-next-line node/callback-return -- This is a value listener or middleware continuation, not a Node-style completion callback.
  const result = await next();

  const end = Date.now();
  setSpanAttributes({
    "tailorkit.duration_ms": end - start,
    "tailorkit.orpc.path": path,
    "tailorkit.package": "api-utils",
  });

  return result;
});
