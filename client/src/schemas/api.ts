import { z } from "zod";

export const ApiErrorResponseSchema = z.object({
  error: z.union([
    z.string(),
    z.object({
      code: z.string().optional(),
      message: z.string().optional(),
      type: z.string().optional(),
    }),
  ]),
});
