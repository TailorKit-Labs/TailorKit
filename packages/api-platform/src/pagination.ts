import { z } from "zod";

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const paginationMetadata = z.object({
  hasMore: z.boolean(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});

export const paginatedOutput = <TItem extends z.ZodType>(item: TItem) =>
  z.object({
    body: z.object({
      items: z.array(item),
      pagination: paginationMetadata,
    }),
  });
