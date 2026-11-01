import { auditService } from '../services/auditService';
import * as rewardService from '../services/rewardService';
import { actorOf, handler, parse } from './helpers';
import { attainmentQuerySchema, rewardSettingsSchema } from '../validators/rewardSchema';

/** M6-T09: the rewards API. Routes -> this file -> rewardService. */

/** GET /api/rewards/settings: tiers by role, rep pay, badges switch. */
export const getSettings = handler(async (_req, res) => {
  res.json(await rewardService.getRewardSettings());
});

/** PUT /api/rewards/settings: save what is sent. One audit row. */
export const putSettings = handler(async (req, res) => {
  const body = parse(rewardSettingsSchema, req.body);
  const settings = await rewardService.saveRewardSettings(body);
  await auditService.recordFromRequest(req, {
    action: 'rewards_settings_update', resource: 'rewards', resourceId: 'settings',
    metadata: { changed: Object.keys(body), roleIds: body.tiers?.map((t) => t.roleId) ?? [] },
  });
  res.json(settings);
});

/** GET /api/rewards/attainment?period=YYYY-MM&userId&roleId. */
export const getAttainment = handler(async (req, res) => {
  res.json(await rewardService.attainment(actorOf(req), parse(attainmentQuerySchema, req.query, 'query')));
});
