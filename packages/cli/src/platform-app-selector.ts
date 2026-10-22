const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/** Adapt the host RPC's legacy UUID-or-short-ID input to the platform contract. */
export const platformAppSelector = (appId: string) => {
  if (uuidPattern.test(appId)) {
    return { id: appId };
  }

  return { shortId: appId };
};
