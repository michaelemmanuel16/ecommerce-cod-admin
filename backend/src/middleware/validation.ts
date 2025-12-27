import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';
import logger from '../utils/logger';

export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    // ONLY log validation errors, NOT request data (prevents password/token leakage)
    logger.warn('Validation failed', {
      path: req.path,
      method: req.method,
      errors: errors.array().map(e => ({
        field: e.type === 'field' ? e.path : e.type,
        message: e.msg
      }))
    });
    // DO NOT log req.body or req.params

    res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
    return;
  }

  next();
};

/**
 * Validation middleware factory that properly handles async validation chains
 * This ensures all validations complete before checking results
 */
export const validateRequest = (validations: ValidationChain[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Run all validations sequentially
    for (const validation of validations) {
      const result = await validation.run(req);
      if (!result.isEmpty()) {
        break; // Stop on first validation failure
      }
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // ONLY log validation errors, NOT request data (prevents password/token leakage)
      logger.warn('Validation failed', {
        path: req.path,
        method: req.method,
        errors: errors.array().map(e => ({
          field: e.type === 'field' ? e.path : e.type,
          message: e.msg
        }))
      });
      // DO NOT log req.body or req.params

      res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    next();
  };
};
