import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import { uploadDir } from '../config/multer';
import { isStorageUrl } from '../config/r2';
import { verifyProofPhotoLink } from '../services/deliveryProofService';

/**
 * GET /api/deliveries/proof-photo/:deliveryId?t&exp&sig (M4-T20). No bearer token: the signed, expiring link is the
 * credential (an <img> cannot send one). An expired or altered link is 403.
 */
export const getProofPhoto = async (req: Request, res: Response): Promise<void> => {
  const deliveryId = Number(req.params.deliveryId);
  const { t, exp, sig } = req.query;
  if (!Number.isInteger(deliveryId) || !verifyProofPhotoLink({ deliveryId, tenantId: t, exp, sig })) {
    res.status(403).json({ error: 'This photo link is not valid or has expired' });
    return;
  }

  const delivery = await runInTenant(t as string, () => prisma.delivery.findUnique({ where: { id: deliveryId }, select: { proofImageUrl: true } }));
  const url = delivery?.proofImageUrl;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!url) {
    res.status(404).json({ error: 'No photo recorded' });
    return;
  }
  if (url.startsWith('/uploads/')) {
    const file = path.join(uploadDir, path.basename(url));
    if (!fs.existsSync(file)) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }
    res.sendFile(file);
    return;
  }
  if (isStorageUrl(url)) {
    res.redirect(302, url);
    return;
  }
  res.status(404).json({ error: 'Photo not found' });
};
