import { PrismaClient } from '@prisma/client';
import logger from './logger';
import { softDeleteExtension } from './prismaExtensions';

// Performance monitoring extension
const prismaBase = new PrismaClient({
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

const prisma = prismaBase.$extends(softDeleteExtension);

// Define type for extended client to be used across the app
export type PrismaClientExtended = typeof prisma;

// Query performance logging
prismaBase.$on('query' as never, (e: any) => {
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
prismaBase.$on('error' as never, (e: any) => {
  logger.error('Prisma error:', {
    message: e.message,
    target: e.target,
  });
});

// Warn logging
prismaBase.$on('warn' as never, (e: any) => {
  logger.warn('Prisma warning:', {
    message: e.message,
  });
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prismaBase.$disconnect();
});

export { prismaBase };
export default prisma;
