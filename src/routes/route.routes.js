import { Router } from 'express';
import { getHealth } from '../controllers/routeHealth.controller.js';

const router = Router();

router.get('/health', getHealth);

export default router;
