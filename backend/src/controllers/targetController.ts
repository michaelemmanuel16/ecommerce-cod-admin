import { AuthRequest } from '../types';
import { auditService } from '../services/auditService';
import * as targetService from '../services/targetService';
import * as northStar from '../services/northStarService';
import { handler, idParam, parse } from './helpers';
import {
  calculatorsQuerySchema, childrenSchema, previewQuerySchema, dailyQuerySchema, driversQuerySchema, driversSchema, northStarSchema, poolQuerySchema,
  saveTargetSchema, treeQuerySchema, updateTargetSchema,
} from '../validators/targetSchema';

/** M6-T08: the target API. Routes -> this file -> targetService / northStarService. */

const audit = (req: AuthRequest, action: string, resourceId: string, metadata: Record<string, unknown> = {}) =>
  auditService.recordFromRequest(req, { action, resource: 'target', resourceId, metadata });

/** GET /api/targets/tree?year&month&metric */
export const tree = handler(async (req, res) => {
  const q = parse(treeQuerySchema, req.query, 'query');
  res.json(await northStar.getTree(q.year, q.month, q.metric));
});

/** GET /api/targets/roles/:roleId/pool?month: the role target, what persons hold, the pool, each holder (or "Set a target"). */
export const pool = handler(async (req, res) => {
  res.json(await targetService.roleView(idParam(req.params.roleId), parse(poolQuerySchema, req.query, 'query').month));
});

/** GET /api/targets/daily?metric&date&userId */
export const daily = handler(async (req, res) => {
  const q = parse(dailyQuerySchema, req.query, 'query');
  res.json(await targetService.dailyTargetProgress(q.metric, q.date, q.userId));
});

/** POST /api/targets: save a role, person or daily target. The North Star and its drivers have their own routes (Owner only). */
export const save = handler(async (req, res) => {
  const input = parse(saveTargetSchema, req.body);
  if (input.scope === 'north_star') throw northStar.NORTH_STAR_ONLY();
  const target = await targetService.saveTarget(input);
  await audit(req, 'target_save', String(target.id), { scope: target.scope, metric: target.metric, value: target.value.toString() });
  res.status(201).json({ target });
});

/** PUT /api/targets/:id: change the value of a saved target. */
export const update = handler(async (req, res) => {
  const id = idParam(req.params.id, 'target');
  const body = parse(updateTargetSchema, req.body);
  const target = await northStar.updateTargetValue(id, body.value, body.unit);
  await audit(req, 'target_update', String(id), { value: target.value.toString() });
  res.json({ target });
});

/** PUT /api/targets/:id/children: the quarters of a North Star or the months of a quarter, as a whole set. */
export const children = handler(async (req, res) => {
  const id = idParam(req.params.id, 'target');
  const saved = await targetService.setChildren(id, parse(childrenSchema, req.body).children);
  await audit(req, 'target_set_children', String(id), { count: saved.length });
  res.json({ children: saved });
});

/** DELETE /api/targets/:id */
export const remove = handler(async (req, res) => {
  const id = idParam(req.params.id, 'target');
  await northStar.removeTarget(id);
  await audit(req, 'target_delete', String(id));
  res.json({ message: 'Target deleted' });
});

/** POST /api/targets/north-star: create or re-plan the year's tree. */
export const saveNorthStar = handler(async (req, res) => {
  const input = parse(northStarSchema, req.body);
  const result = await northStar.saveNorthStar(input);
  await audit(req, 'north_star_save', String(result.northStar?.id ?? input.year), { year: input.year, annual: input.annual, mode: input.mode, pastMonthsKept: result.pastMonthsKept });
  res.status(201).json(result);
});

/** GET /api/targets/drivers?year */
export const drivers = handler(async (req, res) => {
  res.json(await northStar.getDrivers(parse(driversQuerySchema, req.query, 'query').year));
});

/** PUT /api/targets/drivers: planned AOV (null resets it), rates, margin. */
export const saveDrivers = handler(async (req, res) => {
  const { year, ...input } = parse(driversSchema, req.body);
  const result = await northStar.saveDrivers(year, input);
  await audit(req, 'drivers_save', String(year), { fields: Object.keys(input) });
  res.json(result);
});

/** GET /api/targets/calculators?month&aov&confirmationRate&deliverySuccessRate&revenueTarget&profitPerOrder: a preview, nothing is saved. */
export const calculators = handler(async (req, res) => {
  res.json(await northStar.calculators(parse(calculatorsQuerySchema, req.query, 'query')));
});

/** GET /api/targets/north-star/preview?annual&mode&customQuarters: the quarters and months of a split, nothing is saved. */
export const preview = handler(async (req, res) => {
  const q = parse(previewQuerySchema, req.query, 'query');
  res.json(await northStar.previewNorthStar(q));
});
