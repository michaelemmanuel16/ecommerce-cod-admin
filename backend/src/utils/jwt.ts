import jwt from 'jsonwebtoken';
import { JWTPayload } from '../types';

// Enforce environment variables - no defaults for security
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

if (!process.env.JWT_REFRESH_SECRET) {
  throw new Error('JWT_REFRESH_SECRET environment variable is required');
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

export const generateAccessToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
};

export const generateRefreshToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });
};

export const verifyAccessToken = (token: string): JWTPayload => {
  const decoded = jwt.verify(token, JWT_SECRET) as any;

  // Validate ID type - handle migration from string (CUID) to integer IDs
  if (typeof decoded.id !== 'number') {
    throw new Error('TOKEN_FORMAT_OUTDATED');
  }

  return decoded as JWTPayload;
};

export const verifyRefreshToken = (token: string): JWTPayload => {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as any;

  // Validate ID type - handle migration from string (CUID) to integer IDs
  if (typeof decoded.id !== 'number') {
    throw new Error('TOKEN_FORMAT_OUTDATED');
  }

  return decoded as JWTPayload;
};
