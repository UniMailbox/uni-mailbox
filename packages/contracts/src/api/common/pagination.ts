import { z } from "zod";

export const CursorPaginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const CursorPageSchema = <TItem extends z.ZodTypeAny>(item: TItem) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
