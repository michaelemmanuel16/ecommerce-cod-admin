import { auditService } from '../services/auditService';
import * as periodClose from '../services/periodCloseService';
import { actorOf, handler } from './helpers';

/** M6-T10: month close for the Owner. Routes -> this file -> periodCloseService. */

/** POST /api/period-close/:period/preview: the rewards a close would create. Writes nothing. */
export const preview = handler(async (req, res) => {
  res.json(await periodClose.previewPeriodClose(req.params.period));
});

/** POST /api/period-close/:period: create and post the rewards, lock the month. A repeat returns what the month holds. */
export const run = handler(async (req, res) => {
  const result = await periodClose.runPeriodClose(req.params.period, actorOf(req).id);
  if (!result.alreadyClosed) {
    await auditService.recordFromRequest(req, {
      action: 'period_close', resource: 'period', resourceId: result.period,
      metadata: { created: result.created, closedTargets: result.closedTargets, total: result.total },
    });
  }
  res.json(result);
});
