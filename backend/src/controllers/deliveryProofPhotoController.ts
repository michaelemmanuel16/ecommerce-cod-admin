import { Request, Response } from 'express';
import path from 'path';
import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import { uploadDir } from '../config/multer';
import { isStorageUrl } from '../config/r2';
import { verifyProofPhotoLink } from '../services/deliveryProofService';

/**
 * GET /api/deliveries/proof-photo/:deliveryId?t&exp&sig (M4-T20). No bearer token: the signed, expiring link is the
 * credential (an <img> cannot send one). An expired or altered link is 403. The link works from another origin
 * (the app and the API are on different origins in local dev), so the response is marked cross-origin for helmet's default.
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
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!url) {
    res.status(404).json({ error: 'No photo recorded' });
    return;
  }
  if (url.startsWith('/uploads/')) {
    const file = path.join(uploadDir, path.basename(url));
    await new Promise<void>((done) => {
      res.sendFile(file, (err) => {
        // A missing file is a 404; a send that failed after it began has no status left to change
        if (err && !res.headersSent) res.status(404).json({ error: 'Photo not found' });
        done();
      });
    });
    return;
  }
  if (isStorageUrl(url)) {
    res.redirect(302, url);
    return;
  }
  res.status(404).json({ error: 'Photo not found' });
};
