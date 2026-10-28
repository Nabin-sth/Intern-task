import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from './asyncHandler.js';

export const requireAuth = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new AppError('Authentication required', 401);
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw new AppError('Authentication required', 401);
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret);
  } catch (error) {
    console.log("error:", error);
    throw new AppError('Invalid or expired token', 401);
  }

  const userId = payload.sub;
  if (!userId) {
    throw new AppError('Invalid or expired token', 401);
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('Invalid or expired token', 401);
  }

  req.user = { id: user.id, email: user.email };
  next();
});
