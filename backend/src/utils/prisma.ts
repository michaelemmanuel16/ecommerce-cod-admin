import { PrismaClient } from '@prisma/client';
import logger from './logger';

// Performance monitoring extension
const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
  // Connection pooling configuration
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

// Query performance logging
prisma.$on('query' as never, (e: any) => {
  const duration = e.duration;

  if (duration > 100) {
    logger.warn(`Slow query detected (${duration}ms): ${e.query}`, {
      duration,
      query: e.query,
      params: e.params,
    });
  } else if (process.env.NODE_ENV === 'development') {
    logger.debug(`Query executed (${duration}ms): ${e.query.substring(0, 100)}...`);
  }
});

// Error logging
prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma error:', {
    message: e.message,
    target: e.target,
  });
});

// Warn logging
prisma.$on('warn' as never, (e: any) => {
  logger.warn('Prisma warning:', {
    message: e.message,
  });
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
