import { getDbStatus } from '../config/db.js';

export function getHealth(_req, res) {
  const db = getDbStatus();

  res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      service: 'mini-sms-gateway',
      db,
    },
  });
}
