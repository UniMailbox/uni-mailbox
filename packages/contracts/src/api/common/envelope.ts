import { z } from "zod";

export const ApiSuccessEnvelopeSchema = <TSchema extends z.ZodTypeAny>(
  schema: TSchema,
) => z.object({ data: schema });

export const ApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
    params: z.unknown().optional(),
    requestId: z.string().min(1).optional(),
  }),
});

export type ApiErrorEnvelope = z.output<typeof ApiErrorEnvelopeSchema>;
