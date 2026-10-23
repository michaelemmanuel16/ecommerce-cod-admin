import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { getRegionsForCountry } from '../utils/regions';
import { verifyAccessToken } from '../utils/jwt';
import { countryCodeOf, countryCodeOfTenant } from '../services/locationService';

/**
 * GET /api/reference/regions[?country=GH|Ghana] — static reference data, no tenant data, no login needed.
 * `country` wins; without it a valid token gives the store's country; with neither it is a 400.
 */
export const getRegions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asked = typeof req.query.country === 'string' ? req.query.country.trim() : '';
    let country: string | null = asked ? countryCodeOf(asked) : null;
    if (asked && !country) throw new AppError('country must be a country name or a 2-letter ISO code, for example GH', 400);
    if (!country) {
      // Token is optional here: a bad or missing one only means there is no store country to fall back on.
      const bearer = req.headers.authorization;
      let tenantId: string | undefined;
      try {
        tenantId = bearer?.startsWith('Bearer ') ? verifyAccessToken(bearer.substring(7)).tenantId ?? undefined : undefined;
      } catch {
        tenantId = undefined;
      }
      if (tenantId) country = await countryCodeOfTenant(tenantId);
    }
    if (!country) throw new AppError('country is required', 400);
    // The answer depends on the token when no country is asked for, so caches must key on it.
    res.set({ 'Cache-Control': 'public, max-age=86400', Vary: 'Authorization' });
    res.json({ country, regions: getRegionsForCountry(country) });
  } catch (error) {
    next(error);
  }
};
