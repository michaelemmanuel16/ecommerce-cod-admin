import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import { upsellService } from '../services/upsellService';

export const getUpsellOptions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const options = await upsellService.getUpsellOptions(orderId, req.user?.tenantId ?? undefined);
    res.json(options);
  } catch (error) {
    next(error);
  }
};

export const applyUpsell = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const { packageId, addOnIds, openedAt, expectedStatusVersion } = req.body;

    const result = await upsellService.applyUpsell({
      orderId,
      repId: req.user!.id,
      packageId: packageId != null ? parseInt(packageId, 10) : undefined,
      addOnIds: Array.isArray(addOnIds) ? addOnIds.map((id: any) => parseInt(id, 10)) : undefined,
      openedAt,
      expectedStatusVersion: expectedStatusVersion != null ? parseInt(expectedStatusVersion, 10) : undefined,
      tenantId: req.user?.tenantId ?? undefined,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};
