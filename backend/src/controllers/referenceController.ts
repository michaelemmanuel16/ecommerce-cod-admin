import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { getRegionsForCountry } from '../utils/regions';

/** GET /api/reference/regions?country=GH — static reference data, no tenant data. */
export const getRegions = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const country = typeof req.query.country === 'string' ? req.query.country.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(country)) {
      throw new AppError('country must be a 2-letter ISO code, for example GH', 400);
    }
    res.set('Cache-Control', 'private, max-age=86400');
    res.json({ country, regions: getRegionsForCountry(country) });
  } catch (error) {
    next(error);
  }
};
