import logger from '../utils/logger';

interface EnvironmentConfig {
  // Server
  PORT: number;
  NODE_ENV: string;

  // Database
  DATABASE_URL: string;

  // Security
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  WEBHOOK_SECRET: string;

  // Redis
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;

  // Frontend
  FRONTEND_URL: string;

  // Feature flags
  // MAN-86: gates multi-store-per-login behavior. Default false — owners stay
  // single-store until go-live. The ownerUserId backfill + read-switch are
  // equivalence-preserving and ship independent of this flag; the flag gates
  // the owner tenantId nulling (MAN-86-B) and the multi-store write/UI paths.
  MULTI_STORE_ENABLED: boolean;
}

const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'WEBHOOK_SECRET',
  'REDIS_HOST',
  'REDIS_PORT'
];

export function validateEnvironment(): EnvironmentConfig {
  const missingVars: string[] = [];

  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    const errorMsg = `Missing required environment variables: ${missingVars.join(', ')}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Validate JWT secrets are strong enough
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }

  if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long');
  }

  if (process.env.WEBHOOK_SECRET && process.env.WEBHOOK_SECRET.length < 32) {
    throw new Error('WEBHOOK_SECRET must be at least 32 characters long');
  }

  const config: EnvironmentConfig = {
    PORT: parseInt(process.env.PORT || '3000', 10),
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: process.env.JWT_SECRET!,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET!,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET!,
    REDIS_HOST: process.env.REDIS_HOST!,
    REDIS_PORT: parseInt(process.env.REDIS_PORT!, 10),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
    MULTI_STORE_ENABLED: isMultiStoreEnabled()
  };

  logger.info('Environment validation passed');
  return config;
}

export function getEnvConfig(): EnvironmentConfig {
  return validateEnvironment();
}

/**
 * MAN-86: single source of truth for the multi-store-per-login feature flag.
 * Defaults to false so existing single-store behavior is unchanged until go-live.
 */
export function isMultiStoreEnabled(): boolean {
  return process.env.MULTI_STORE_ENABLED === 'true';
}
