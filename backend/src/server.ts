// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

// Sentry must be initialized before any other imports
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
  });
}

import express, { Application } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { initializeSocket } from './sockets';
import { errorHandler, notFound } from './middleware/errorHandler';
import { apiLimiter, whatsappWebhookLimiter } from './middleware/rateLimiter';
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
import agentInventoryRoutes from './routes/agentInventoryRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import smsRoutes from './routes/smsRoutes';
import communicationRoutes from './routes/communicationRoutes';
import onboardingRoutes from './routes/onboardingRoutes';
import billingRoutes from './routes/billingRoutes';
import { verifyWebhook, handleWebhook } from './controllers/whatsappController';
import { handleOAuthCallback, stopCleanupInterval } from './controllers/whatsappOAuthController';
import { scheduleTokenRefresh } from './services/whatsappTokenRefreshService';
import { GLAutomationService } from './services/glAutomationService';
import { GLAccountService } from './services/glAccountService';
import cron from 'node-cron';

// Initialize queue workers
import './queues/workflowQueue';

import { setupAgingCron } from './queues/agingQueue';
import { setupFinancialReconciliationCron } from './queues/financialReconciliationQueue';
import { setupMessageCleanupCron } from './queues/messageCleanupQueue';

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

app.use(express.json({
  limit: '10mb',
  // Preserve raw body buffer on webhook routes for HMAC signature verification
  verify: (req: any, _res, buf) => {
    if (req.originalUrl?.startsWith('/api/whatsapp/webhook')) {
      req.rawBody = buf;
    }
  },
}));
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

// Serve static files from uploads directory with security headers
app.use('/uploads', (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
  next();
}, express.static(path.join(__dirname, '../uploads')));

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
app.use('/api/webhooks', apiLimiter, webhookRoutes);
app.use('/api/analytics', apiLimiter, analyticsRoutes);
app.use('/api/notifications', apiLimiter, notificationRoutes);
app.use('/api/upload', apiLimiter, uploadRoutes);
app.use('/api/checkout-forms', apiLimiter, checkoutFormRoutes);
app.use('/api/calls', apiLimiter, callRoutes);
app.use('/api/agent-reconciliation', apiLimiter, agentReconciliationRoutes);
app.use('/api/agent-inventory', apiLimiter, agentInventoryRoutes);
// WhatsApp webhook endpoints — dedicated high-limit rate limiter (1000/15min prod)
// bypasses apiLimiter (500/15min) since Meta sends bursts of status callbacks
app.get('/api/whatsapp/webhook', whatsappWebhookLimiter, verifyWebhook);
app.post('/api/whatsapp/webhook', whatsappWebhookLimiter, handleWebhook);
// WhatsApp OAuth callback — unauthenticated (CSRF state validates the request)
app.get('/api/whatsapp/oauth/callback', apiLimiter, handleOAuthCallback);
// Admin endpoints use standard rate limiter
app.use('/api/whatsapp', apiLimiter, whatsappRoutes);
app.use('/api/sms', apiLimiter, smsRoutes);
app.use('/api/communications', apiLimiter, communicationRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/billing', billingRoutes);

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
      whatsapp: '/api/whatsapp',
      public: '/api/public'
    }
  });
});

// Error handling
app.use(notFound);
// Sentry error handler must be before custom error handler
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}
app.use(errorHandler);

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, async () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Setup Agent Aging Cron Job
    await setupAgingCron();

    // Setup Financial Reconciliation Cron Job
    await setupFinancialReconciliationCron();

    // Setup Message Log Cleanup Cron Job
    await setupMessageCleanupCron();

    // Daily GL balance verification at 02:00 AM
    cron.schedule('0 2 * * *', async () => {
      logger.info('Running daily GL balance verification...');
      try {
        const result = await GLAccountService.verifyAllAccountBalances();
        if (result.unbalanced.length > 0) {
          logger.error('GL balance verification found discrepancies', {
            totalAccounts: result.totalAccounts,
            unbalancedCount: result.unbalanced.length,
            maxDifference: result.maxDifference.toFixed(4),
            unbalanced: result.unbalanced.map(u => ({ code: u.code, difference: u.difference.toFixed(4) }))
          });
        } else {
          logger.info(`GL balance verification passed: ${result.totalAccounts} accounts verified`);
        }
      } catch (err) {
        logger.error('GL balance verification cron failed', { error: err });
      }
    });

    // Daily cleanup of old upload files at 03:00 AM
    cron.schedule('0 3 * * *', async () => {
      logger.info('Running daily upload cleanup...');
      try {
        const uploadsDir = path.join(__dirname, '../uploads');
        try { await fs.promises.access(uploadsDir); } catch { return; }
        const files = await fs.promises.readdir(uploadsDir);
        const cutoff = Date.now() - (60 * 24 * 60 * 60 * 1000);
        let deleted = 0;
        for (const file of files) {
          const filePath = path.join(uploadsDir, file);
          const stat = await fs.promises.stat(filePath);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            await fs.promises.unlink(filePath);
            deleted++;
          }
        }
        logger.info(`Upload cleanup complete: deleted ${deleted} files older than 60 days`);
      } catch (error) {
        logger.error('Upload cleanup failed:', error);
      }
    });

    // Verify GL Accounts (Required for financial statements correctness)
    const glValidated = await GLAutomationService.asyncVerifyGLAccounts();
    if (!glValidated) {
      logger.error('Failed to validate/seed GL accounts. Exiting...');
      process.exit(1);
    }

    // Schedule WhatsApp OAuth token refresh (daily at 01:00)
    scheduleTokenRefresh();

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
const shutdown = async (signal: string) => {
  logger.info(`${signal} signal received: closing HTTP server`);

  // Set a force-kill timeout
  const forceKillTimeout = setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 5000);

  try {
    // 0. Stop OAuth cleanup interval
    stopCleanupInterval();

    // 1. Close Socket.io connections
    if (io) {
      logger.info('Closing Socket.io connections...');
      io.close();
    }

    // 2. Close HTTP server
    server.close(() => {
      logger.info('HTTP server closed');

      // 3. Disconnect from database
      import('./utils/prisma').then(({ default: prismaBase }) => {
        prismaBase.$disconnect().finally(() => {
          logger.info('Database disconnected');
          clearTimeout(forceKillTimeout);
          process.exit(0);
        });
      });
    });
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', {
    promise,
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
});

export default app;
