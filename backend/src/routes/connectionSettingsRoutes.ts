import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { authenticate, requirePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { AppError } from '../middleware/errorHandler';
import { smsReportUrl, sendSmtpTest } from '../services/connectionSettingsService';

/** Settings backends of the Connections page (M9-T27). Owner and admin only. */
const router = Router();
router.use(authenticate);
router.use(tenantRateLimiter);
router.use(requirePermission(['super_admin', 'admin']));

const smtpSchema = z.object({
  smtpHost: z.string().trim().max(255).optional(),
  smtpPort: z.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().trim().max(255).optional(),
  password: z.string().max(500).optional(),
  fromEmail: z.string().trim().email().max(255).optional(),
});

/** `GET /api/settings/sms/report-url`: the Arkesel delivery-report URL with its token. */
router.get('/sms/report-url', (_req: AuthRequest, res: Response) => {
  res.json(smsReportUrl());
});

/** `POST /api/settings/smtp/test`: one test email to the caller; the SMTP server's error text on failure (400). */
router.post('/smtp/test', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = smtpSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid SMTP fields', 400, 'VALIDATION_ERROR');
    res.json(await sendSmtpTest(req.user!.email, parsed.data));
  } catch (error) {
    next(error);
  }
});

export default router;
