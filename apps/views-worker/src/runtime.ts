import { installationName } from "@patchsmith/api-utils/app-auth";
import type { Session } from "@patchsmith/app/client/connection";

export interface InstallationNamespace {
  getByName: (
    name: string,
    options: { locationHint: "enam" }
  ) => {
    fetch: (request: Request) => Promise<Response>;
  };
}

/** Only sessions minted from authorized discovery rows can select an object. */
export const installationTransport = (
  stores: InstallationNamespace,
  issuer: string
) => {
  const sessions = new Map<string, Session>();

  return {
    fetch: (async (input, init) => {
      const request =
        input instanceof Request && !init ? input : new Request(input, init);

      const session = sessions.get(request.url);

      if (
        !session ||
        request.headers.get("authorization") !== `Bearer ${session.token}` ||
        request.method !== "POST"
      ) {
        throw new Error(
          "Runtime request does not match an authorized installation session"
        );
      }

      const destination = new URL(request.url);
      destination.pathname = "/rpc/actions";

      // The object performs its normal JWT verification; this only skips the public gateway.
      return await stores
        .getByName(installationName(session.identity, issuer), {
          locationHint: "enam",
        })
        .fetch(new Request(destination, request));
    }) satisfies typeof fetch,
    register: (session: Session) => {
      sessions.set(`${session.url}/actions`, session);

      return session;
    },
  };
};
