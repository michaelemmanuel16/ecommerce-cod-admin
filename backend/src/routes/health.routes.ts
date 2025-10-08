import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const router = Router();
const prisma = new PrismaClient();

// Health check endpoint - Basic
router.get('/health', async (req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Readiness probe - Checks if service is ready to handle requests
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check Redis connection
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });

    await redis.ping();
    redis.disconnect();

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'ok',
        redis: 'ok',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'not ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Liveness probe - Checks if service is alive
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    pid: process.pid,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
  });
});

// Detailed health check with all dependencies
router.get('/health/detailed', async (req: Request, res: Response) => {
  const healthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: { status: 'unknown', responseTime: 0 },
      redis: { status: 'unknown', responseTime: 0 },
    },
    system: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
    },
  };

  let isHealthy = true;

  // Check database
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbEnd = Date.now();
    healthStatus.checks.database = {
      status: 'ok',
      responseTime: dbEnd - dbStart,
    };
  } catch (error) {
    isHealthy = false;
    healthStatus.checks.database = {
      status: 'error',
      responseTime: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    } as any;
  }

  // Check Redis
  try {
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });

    const redisStart = Date.now();
    await redis.ping();
    const redisEnd = Date.now();
    redis.disconnect();

    healthStatus.checks.redis = {
      status: 'ok',
      responseTime: redisEnd - redisStart,
    };
  } catch (error) {
    isHealthy = false;
    healthStatus.checks.redis = {
      status: 'error',
      responseTime: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    } as any;
  }

  healthStatus.status = isHealthy ? 'healthy' : 'unhealthy';

  res.status(isHealthy ? 200 : 503).json(healthStatus);
});

// Metrics endpoint (Prometheus format)
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const metrics = [];

    // Process metrics
    metrics.push(`# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.`);
    metrics.push(`# TYPE process_cpu_seconds_total counter`);
    metrics.push(`process_cpu_seconds_total ${process.cpuUsage().user / 1000000}`);

    metrics.push(`# HELP process_resident_memory_bytes Resident memory size in bytes.`);
    metrics.push(`# TYPE process_resident_memory_bytes gauge`);
    metrics.push(`process_resident_memory_bytes ${process.memoryUsage().rss}`);

    metrics.push(`# HELP process_heap_bytes_used Heap memory used in bytes.`);
    metrics.push(`# TYPE process_heap_bytes_used gauge`);
    metrics.push(`process_heap_bytes_used ${process.memoryUsage().heapUsed}`);

    metrics.push(`# HELP process_uptime_seconds Process uptime in seconds.`);
    metrics.push(`# TYPE process_uptime_seconds gauge`);
    metrics.push(`process_uptime_seconds ${process.uptime()}`);

    // Database connection pool metrics (if available)
    // Add custom application metrics here

    res.set('Content-Type', 'text/plain; version=0.0.4');
    res.send(metrics.join('\n'));
  } catch (error) {
    res.status(500).json({
      error: 'Failed to generate metrics',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
