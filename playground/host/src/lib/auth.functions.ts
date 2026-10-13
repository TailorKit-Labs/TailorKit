import { getDemoSessionFromRequest, listSignInChoices } from "@playground/shared/auth";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const loadSession = createServerFn({ method: "GET" }).handler(() =>
  getDemoSessionFromRequest(getRequest()),
);

export const loadSignInChoices = createServerFn({ method: "GET" }).handler(() =>
  listSignInChoices(),
);
