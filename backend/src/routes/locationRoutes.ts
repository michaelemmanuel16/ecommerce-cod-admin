import { Router, Response, NextFunction } from 'express';
import { authenticate, hasPermission } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getTownsOfState } from '../controllers/locationController';

const router = Router();

// Anyone who can create an order or create/edit a customer picks a town.
const TOWN_PICKERS: Array<[string, string]> = [['orders', 'create'], ['customers', 'create'], ['customers', 'update']];

async function canPickTown(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    for (const [resource, action] of TOWN_PICKERS) {
      if (req.user && (await hasPermission(req.user, resource, action))) {
        next();
        return;
      }
    }
    res.status(403).json({ error: 'Forbidden: Cannot create orders or customers', code: 'INSUFFICIENT_PERMISSION' });
  } catch (error) {
    next(error);
  }
}

router.get('/towns', authenticate, canPickTown, getTownsOfState);

export default router;
