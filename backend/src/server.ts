// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express, { Application } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { initializeSocket } from './sockets';
import { errorHandler, notFound } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import logger from './utils/logger';
import { validateEnvironment } from './config/validateEnv';

// Routes
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import customerRoutes from './routes/customerRoutes';
import productRoutes from './routes/productRoutes';
import orderRoutes from './routes/orderRoutes';
import deliveryRoutes from './routes/deliveryRoutes';
import financialRoutes from './routes/financialRoutes';
import workflowRoutes from './routes/workflowRoutes';
import webhookRoutes from './routes/webhookRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import notificationRoutes from './routes/notificationRoutes';
import healthRoutes from './routes/health.routes';

// Validate environment variables before starting server
try {
  validateEnvironment();
  logger.info('Environment variables validated successfully');
} catch (error) {
  logger.error('Environment validation failed:', error);
  process.exit(1);
}

const app: Application = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize Socket.io
export const io = initializeSocket(server);

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// Health check routes (without rate limiting for monitoring)
app.use('/', healthRoutes);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/customers', apiLimiter, customerRoutes);
app.use('/api/products', apiLimiter, productRoutes);
app.use('/api/orders', apiLimiter, orderRoutes);
app.use('/api/deliveries', apiLimiter, deliveryRoutes);
app.use('/api/financial', apiLimiter, financialRoutes);
app.use('/api/workflows', apiLimiter, workflowRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/analytics', apiLimiter, analyticsRoutes);
app.use('/api/notifications', apiLimiter, notificationRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'E-commerce COD Admin API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      customers: '/api/customers',
      products: '/api/products',
      orders: '/api/orders',
      deliveries: '/api/deliveries',
      financial: '/api/financial',
      workflows: '/api/workflows',
      webhooks: '/api/webhooks',
      analytics: '/api/analytics',
      notifications: '/api/notifications'
    }
  });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Socket.io initialized`);
  console.log(`
    ╔═══════════════════════════════════════════════════════════════╗
    ║                                                               ║
    ║   E-commerce COD Admin API                                   ║
    ║   Server running on: http://localhost:${PORT}                   ║
    ║   Environment: ${process.env.NODE_ENV || 'development'}                                      ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export default app;
