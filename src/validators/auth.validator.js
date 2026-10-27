import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().email('email must be a valid email address').max(254),
  password: z
    .string()
    .min(8, 'password must be at least 8 characters')
    .max(72, 'password must be at most 72 characters'),
});

export const loginSchema = registerSchema;
