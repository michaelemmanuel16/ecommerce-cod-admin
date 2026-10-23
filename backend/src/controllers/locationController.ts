import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { getTenantId } from '../utils/tenantContext';
import { countryCodeOfTenant, getTowns } from '../services/locationService';

/** GET /api/locations/towns?state=Ashanti — towns of one state in the tenant's store country. */
export const getTownsOfState = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    if (!state) throw new AppError('state is required', 400);
    const country = await countryCodeOfTenant(getTenantId());
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({ country, state, towns: getTowns(country, state) });
  } catch (error) {
    next(error);
  }
};
