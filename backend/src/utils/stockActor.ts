import { UserRole } from '@prisma/client';
import { AuthRequest } from '../types';

/** The signed-in user as the stock services (transfers, shipments, counts) see them. */
export interface StockActor {
  id: number;
  role: UserRole;
}

export const actorOf = (req: AuthRequest): StockActor => ({ id: req.user!.id, role: req.user!.role });
