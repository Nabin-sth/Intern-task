import express from 'express';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import smsRoutes from './routes/sms.routes.js';
import routeRoutes from './routes/route.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();

app.use(express.json());

app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/sms', smsRoutes);
app.use('/routes', routeRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
