import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

export function notFoundHandler(req, res, next) {
  next(new AppError(`Cannot ${req.method} ${req.originalUrl}`, 404));
}

function formatZodError(err) {
  return err.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export function errorHandler(err, req, res, next) {
  void next;

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        details: formatZodError(err),
      },
    });
  }

  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({
      success: false,
      error: { message: 'Invalid JSON body' },
    });
  }

  if (err?.code === 11000) {
    return res.status(409).json({
      success: false,
      error: { message: 'Resource already exists' },
    });
  }

  const statusCode = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
  const isAppError = err instanceof AppError;
  const isProduction = env.isProduction;

  if (!isAppError || statusCode >= 500) {
    console.error('[error]', err);
  }

  const payload = {
    success: false,
    error: {
      message: !isAppError && isProduction ? 'Internal server error' : err.message,
    },
  };

  if (isAppError && err.details) {
    payload.error.details = err.details;
  }

  if (!isProduction && err.stack) {
    payload.error.stack = err.stack;
  }

  res.status(statusCode).json(payload);
}
