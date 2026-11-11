import * as winston from 'winston';
import * as path from 'path';
import { redactSecrets } from './safeError';

const logDir = path.join(process.cwd(), 'logs');

/** Removes tokens from the message, the stack and every string value of the meta (`error` included). */
export const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    const value = info[key];
    if (typeof value === 'string') info[key] = redactSecrets(value);
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    redactFormat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'ecommerce-cod-api' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'test') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

export default logger;
