import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler';

/**
 * SaaS signup flag (F-123). `SAAS_SIGNUP_ENABLED=true` turns on tenant self-signup and the subscription callback;
 * unset or anything else is off. Read on every call, so a test or an ops restart needs no code change.
 */
export const isSaasSignupEnabled = (): boolean => process.env.SAAS_SIGNUP_ENABLED === 'true';

/** Answers 404 while the flag is off, as if the route did not exist. */
export const requireSaasSignup = (_req: Request, _res: Response, next: NextFunction): void => {
  next(isSaasSignupEnabled() ? undefined : new AppError('Not found', 404));
};
