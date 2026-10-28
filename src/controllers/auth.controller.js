import { asyncHandler } from '../middleware/asyncHandler.js';
import * as authService from '../services/auth.service.js';

export const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);
  res.status(201).json({ success: true, data });
});

export const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);
  res.status(200).json({ success: true, data });
});

export const me = asyncHandler(async (req, res) => {
  console.log("req.user.id:", req.user.id);
  const data = await authService.getCurrentUser(req.user.id);
  console.log("data:", data);
  res.status(200).json({ success: true, data });
});
