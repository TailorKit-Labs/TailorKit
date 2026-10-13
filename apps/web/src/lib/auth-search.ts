import { z } from "zod";

const searchString = z.string();
export const optionalAuthSearchString = z.preprocess((value) => {
  const parsed = searchString.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}, searchString.optional());

export const authRedirectSearchSchema = z.object({
  return_to: optionalAuthSearchString,
});
