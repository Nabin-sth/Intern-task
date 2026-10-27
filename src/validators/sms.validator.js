import { z } from 'zod';

export const sendSmsSchema = z.object({
  to: z.array(z.string().min(1)).min(1, 'to must include at least one phone number'),
  message: z.string().min(1, 'message is required').max(4096),
});

export const logsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['pending', 'sent', 'failed']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    phone: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from.getTime() > value.to.getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'from must be before or equal to to',
      });
    }
  });
