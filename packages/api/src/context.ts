import { auth } from "@tailorkit/auth";
import type { Session, User } from "@tailorkit/auth";
import {
  initializeObservability,
  setSpanAttributes,
  withSpan,
} from "@tailorkit/observability";
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
  await initializeObservability("tailorkit-web");

  return withSpan("api.create_context", async () => {
    const sessionData = await auth.api.getSession({
      headers: request.headers,
    });
    const ip = ipAddress(request) ?? "unknown";

    setSpanAttributes({
      "tailorkit.authenticated": Boolean(sessionData?.user),
      "tailorkit.package": "api",
    });

    return {
      headers: request.headers,
      ip,
      session: sessionData?.session,
      user: sessionData?.user,
    };
  });
};
