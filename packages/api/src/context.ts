import { auth } from "@patchsmith/auth";
import type { Session, User } from "@patchsmith/auth";
import {
  initializeObservability,
  setSpanAttributes,
  withSpan,
} from "@patchsmith/observability";
import { ipAddress } from "@vercel/functions";

export interface Context {
  session: Session | null | undefined;
  user: User | null | undefined;
  ip: string;
  headers: Headers;
}

export const createContext = async ({
  request,
}: {
  request: Request;
}): Promise<Context> => {
  await initializeObservability("patchsmith-web");

  return await withSpan("api.create_context", async () => {
    const sessionData = await auth.api.getSession({
      headers: request.headers,
    });
    const ip = ipAddress(request) ?? "unknown";

    setSpanAttributes({
      "patchsmith.authenticated": Boolean(sessionData?.user),
      "patchsmith.package": "api",
    });

    return {
      headers: request.headers,
      ip,
      session: sessionData?.session,
      user: sessionData?.user,
    };
  });
};
