// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express, { Application } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { initializeSocket } from './sockets';
import { errorHandler, notFound } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import logger from './utils/logger';
import { validateEnvironment } from './config/validateEnv';
import { setSocketInstance } from './utils/socketInstance';
import { validateGLAccountCodes } from './config/glAccounts';

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
import uploadRoutes from './routes/uploadRoutes';
import adminRoutes from './routes/adminRoutes';
import checkoutFormRoutes from './routes/checkoutFormRoutes';
import publicOrderRoutes from './routes/publicOrderRoutes';
import callRoutes from './routes/callRoutes';
import glRoutes from './routes/glRoutes';
import agentReconciliationRoutes from './routes/agentReconciliationRoutes';
import { GLAutomationService } from './services/glAutomationService';

// Initialize workflow queue worker
import './queues/workflowQueue';
import { setupAgingCron } from './queues/agingQueue';

// Validate environment variables before starting server
try {
  validateEnvironment();
  logger.info('Environment variables validated successfully');
} catch (error) {
  logger.error('Environment validation failed:', error);
  process.exit(1);
}

// Validate GL account codes before starting server
try {
  validateGLAccountCodes();
  logger.info('GL account codes validated successfully');
} catch (error) {
  logger.error('GL account code validation failed:', error);
  process.exit(1);
}

const app: Application = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// Initialize Socket.io
export const io = initializeSocket(server);

// Register Socket.io instance for global access (workflow queues, etc.)
setSocketInstance(io);

// Middleware
/**
 * SECURITY: Helmet Configuration
 *
 * All Helmet protections are enabled by default (CSP, frameguard, etc.).
 * For public checkout routes (/api/public/*), we selectively remove
 * the X-Frame-Options header to allow iframe embedding.
 */
app.use(helmet());
app.use(compression());

// CORS for public API routes - allow all origins for embedding
app.use('/api/public', cors({
  origin: '*', // Allow embedding from any domain
  credentials: false, // No credentials needed for public routes
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Remove X-Frame-Options header for public routes to allow iframe embedding
app.use('/api/public', (_req, res, next) => {
  res.removeHeader('X-Frame-Options');
  next();
});

// CORS for protected routes - restricted to frontend URL only
// Trust proxy - we are behind nginx reverse proxy
app.set("trust proxy", true);

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging (sanitized - no auth headers or sensitive data)
app.use((req, _res, next) => {
  // Sanitize user-agent to prevent log injection
  const userAgent = req.get('user-agent')?.substring(0, 200) || 'unknown';

  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: userAgent.replace(/[^\x20-\x7E]/g, ''), // Remove non-printable chars
    // Never log: Authorization, Cookie, or sensitive headers
  });
  next();
});

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check routes (without rate limiting for monitoring)
app.use('/', healthRoutes);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);
app.use('/api/users', apiLimiter, userRoutes);
app.use('/api/customers', apiLimiter, customerRoutes);
app.use('/api/products', apiLimiter, productRoutes);
app.use('/api/orders', apiLimiter, orderRoutes);
app.use('/api/deliveries', apiLimiter, deliveryRoutes);
app.use('/api/financial', apiLimiter, financialRoutes);
app.use('/api/gl', apiLimiter, glRoutes);
app.use('/api/workflows', apiLimiter, workflowRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/analytics', analyticsRoutes); // No rate limit - already cached & authenticated
app.use('/api/notifications', apiLimiter, notificationRoutes);
app.use('/api/upload', apiLimiter, uploadRoutes);
app.use('/api/checkout-forms', apiLimiter, checkoutFormRoutes);
app.use('/api/calls', apiLimiter, callRoutes);
app.use('/api/agent-reconciliation', apiLimiter, agentReconciliationRoutes);

// Public routes (no authentication required)
app.use('/api/public', publicOrderRoutes);

// Root route
app.get('/', (_req, res) => {
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
      notifications: '/api/notifications',
      upload: '/api/upload',
      checkoutForms: '/api/checkout-forms',
      public: '/api/public'
    }
  });
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, async () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Setup Agent Aging Cron Job
    await setupAgingCron();

    // Verify GL Accounts (Production only requirement for financial stability)
    if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging') {
      const glValidated = await GLAutomationService.asyncVerifyGLAccounts();
      if (!glValidated) {
        logger.error('Failed to validate/seed GL accounts. Exiting...');
        process.exit(1);
      }
    }

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
}

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
  logger.error('Unhandled Rejection at:', {
    promise,
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

export default app;
