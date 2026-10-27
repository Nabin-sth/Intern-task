import { asyncHandler } from '../middleware/asyncHandler.js';
import { listSmsLogs, sendSms } from '../services/sms.service.js';

export const send = asyncHandler(async (req, res) => {
  const data = await sendSms({
    userId: req.user.id,
    to: req.body.to,
    message: req.body.message,
  });

  res.status(200).json({ success: true, data });
});

export const logs = asyncHandler(async (req, res) => {
  const data = await listSmsLogs({
    userId: req.user.id,
    page: req.query.page,
    limit: req.query.limit,
    status: req.query.status,
    from: req.query.from,
    to: req.query.to,
    phone: req.query.phone,
  });

  res.status(200).json({ success: true, data });
});
