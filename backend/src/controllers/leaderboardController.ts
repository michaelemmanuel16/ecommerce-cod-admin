import * as leaderboardService from '../services/leaderboardService';
import * as badgeService from '../services/badgeService';
import * as rewardService from '../services/rewardService';
import { actorOf, handler, parse } from './helpers';
import { badgesQuerySchema, leaderboardQuerySchema, progressQuerySchema } from '../validators/rewardSchema';

/** M6-T11: leaderboard, badges and reward progress. Routes -> this file -> the services. */

/** GET /api/leaderboard?role=call_rep|delivery&period=today|week|month|year|YYYY-MM */
export const getLeaderboard = handler(async (req, res) => {
  res.json(await leaderboardService.leaderboard(actorOf(req), parse(leaderboardQuerySchema, req.query, 'query')));
});

/** GET /api/badges?userId&period */
export const getBadges = handler(async (req, res) => {
  res.json(await badgeService.listBadges(actorOf(req), parse(badgesQuerySchema, req.query, 'query')));
});

/** GET /api/rewards/progress?userId&period (F-1108): the attainment function of the Rewards tab, one person's row for the rep app, agent app and inbox. */
export const getProgress = handler(async (req, res) => {
  const q = parse(progressQuerySchema, req.query, 'query');
  res.json(await rewardService.attainment(actorOf(req), { period: q.period, userId: q.userId ?? actorOf(req).id }));
});
