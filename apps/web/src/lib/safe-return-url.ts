export const getSameOriginPath = (
  value: string | undefined,
  currentOrigin: string
) => {
  if (!(value !== undefined && value !== null && value !== "")) {
    /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
    return undefined;
  }

  try {
    const url = new URL(value, currentOrigin);
    if (url.origin !== currentOrigin) {
      /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
      return undefined;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Invalid URLs are not safe redirect targets.
  }
  // oxlint-disable-next-line unicorn/no-useless-undefined -- Invalid URLs use the same sentinel as other unsafe redirect targets.
  return undefined;
};

export const getSameOriginUrl = (
  value: string | undefined,
  currentOrigin: string
) => {
  const path = getSameOriginPath(value, currentOrigin);

  if (!(path !== undefined && path !== null && path !== "")) {
    /* oxlint-disable-next-line unicorn/no-useless-undefined -- The optional result needs an explicit value on every return path. */
    return undefined;
  }

  return new URL(path, currentOrigin).href;
};

export const getAuthErrorCallbackUrl = (
  route: "/login" | "/sign-up",
  returnTo: string | undefined,
  currentOrigin: string
) => {
  const callbackUrl = new URL(route, currentOrigin);
  const returnPath = getSameOriginPath(returnTo, currentOrigin);

  if (returnPath !== undefined && returnPath !== null && returnPath !== "") {
    callbackUrl.searchParams.set("return_to", returnPath);
  }

  return `${callbackUrl.pathname}${callbackUrl.search}`;
};
