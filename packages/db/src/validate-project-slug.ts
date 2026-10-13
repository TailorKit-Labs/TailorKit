const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const validateProjectSlug = (slug: string) => {
  if (slug.length < 3) {
    return {
      reason: `Slug "${slug}" must be at least 3 characters long.`,
      valid: false,
    } as const;
  }

  if (slug.length > 64) {
    return {
      reason: `Slug "${slug}" must be at most 64 characters long.`,
      valid: false,
    } as const;
  }

  if (!SLUG_RE.test(slug)) {
    return {
      reason: `Slug "${slug}" contains invalid characters.`,
      valid: false,
    } as const;
  }

  return { valid: true } as const;
};
