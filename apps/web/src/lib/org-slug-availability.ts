import { validateOrgSlug } from "@tailorkit/db/validate-org-slug";
import { useEffect, useState } from "react";

import { client } from "#lib/orpc";

const ORG_SLUG_TAKEN_MESSAGE = "This organisation slug is already taken.";
const ORG_SLUG_CHECK_DELAY_MS = 250;

export type OrgSlugAvailability =
  | { status: "idle"; message: string | null }
  | { status: "checking"; message: string | null }
  | { status: "available"; message: null }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export const checkOrgSlugAvailability = async (slug: string) => {
  const result = validateOrgSlug(slug);
  if (!result.valid) {
    return {
      available: false,
      message: result.reason ?? "This slug is reserved and cannot be used.",
    };
  }

  const availability = await client.user.checkOrgSlug({ slug });

  return {
    available: availability.available,
    message: availability.available ? null : ORG_SLUG_TAKEN_MESSAGE,
  };
};

export const useOrgSlugAvailability = (slug: string) => {
  const [availability, setAvailability] = useState<OrgSlugAvailability>({
    message: null,
    status: "idle",
  });

  const [checkedSlug, setCheckedSlug] = useState(slug);
  if (checkedSlug !== slug) {
    setCheckedSlug(slug);
    setAvailability({ message: null, status: slug ? "checking" : "idle" });
  }
  useEffect(() => {
    if (!slug) {
      return;
    }

    let cancelled = false;

    const timeout = window.setTimeout(async () => {
      try {
        const localResult = validateOrgSlug(slug);
        if (!localResult.valid) {
          if (cancelled) {
            return;
          }

          setAvailability(
            slug.length < 3
              ? { message: null, status: "idle" }
              : {
                  message: localResult.reason ?? "This slug is not available.",
                  status: "unavailable",
                }
          );
          return;
        }

        const result = await checkOrgSlugAvailability(slug);
        if (cancelled) {
          return;
        }

        setAvailability(
          result.available
            ? { message: null, status: "available" }
            : {
                message: result.message ?? ORG_SLUG_TAKEN_MESSAGE,
                status: "unavailable",
              }
        );
      } catch {
        if (!cancelled) {
          setAvailability({
            message:
              "Could not check this slug. Try again before creating the organisation.",
            status: "error",
          });
        }
      }
    }, ORG_SLUG_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [slug]);

  return availability;
};
