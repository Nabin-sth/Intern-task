import { Router } from 'express';
import { logs, send } from '../controllers/sms.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { logsQuerySchema, sendSmsSchema } from '../validators/sms.validator.js';

const router = Router();

router.post('/send', requireAuth, validateBody(sendSmsSchema), send);
router.get('/logs', requireAuth, validateQuery(logsQuerySchema), logs);

export default router;
