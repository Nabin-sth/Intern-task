import { asyncHandler } from '../middleware/asyncHandler.js';
import { getRouteHealth } from '../services/routeHealth.service.js';

export const getHealth = asyncHandler(async (_req, res) => {
  const data = await getRouteHealth();
  res.status(200).json({ success: true, data });
});
