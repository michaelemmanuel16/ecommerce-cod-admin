import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationChain } from 'express-validator';

export const validate = (req: Request, res: Response, next: NextFunction): void => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    console.log('Validation failed:', errors.array());
    console.log('Request body:', req.body);
    console.log('Request params:', req.params);
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
      console.log('Validation failed:', errors.array());
      console.log('Request body:', req.body);
      console.log('Request params:', req.params);
      res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
      return;
    }

    next();
  };
};
