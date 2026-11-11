import { Response } from 'express';
import { AuthRequest } from '../types';
import logger from '../utils/logger';
import { isOAuthConfigured } from '../services/metaOAuthService';
import { resolveTenantId } from '../utils/tenantContext';
import {
  MetaAdsError,
  initiateAdsOAuth,
  completeAdsCallback,
  listPickAccounts,
  savePick,
  listAccounts,
  setEnabled,
  deleteAccount,
} from '../services/metaAdsConnectionService';

function fail(res: Response, err: any, what: string): void {
  if (err instanceof MetaAdsError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  logger.error(`Meta Ads: ${what} failed`, { error: err.message });
  res.status(500).json({ error: `Failed to ${what}` });
}

const accountId = (req: AuthRequest) => parseInt(req.params.id, 10);

/** POST /api/meta-ads/oauth/initiate */
export async function initiate(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!isOAuthConfigured()) {
      res.status(400).json({ error: 'Meta OAuth not configured. Set META_APP_ID and META_APP_SECRET.' });
      return;
    }
    res.json({ authUrl: initiateAdsOAuth(req.user!.id, resolveTenantId()) });
  } catch (err: any) {
    fail(res, err, 'start the Meta Ads connection');
  }
}

/** GET /api/meta-ads/oauth/callback (public; the CSRF state authenticates it) */
export async function callback(req: AuthRequest, res: Response): Promise<void> {
  res.redirect(await completeAdsCallback(req.query as Record<string, string | undefined>));
}

/** GET /api/meta-ads/oauth/pick/:pickId */
export async function pickList(req: AuthRequest, res: Response): Promise<void> {
  try {
    res.json({ accounts: await listPickAccounts(req.params.pickId, req.user!.id) });
  } catch (err: any) {
    fail(res, err, 'list ad accounts');
  }
}

/** POST /api/meta-ads/oauth/pick/:pickId  { accountIds } */
export async function pickSave(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { accountIds } = req.body || {};
    if (!Array.isArray(accountIds) || accountIds.length === 0 || !accountIds.every((i) => typeof i === 'string' && /^(act_)?\d+$/.test(i))) {
      res.status(400).json({ error: 'accountIds must be a list of ad account ids' });
      return;
    }
    res.json(await savePick(req.params.pickId, req.user!.id, accountIds));
  } catch (err: any) {
    fail(res, err, 'save ad accounts');
  }
}

/** GET /api/meta-ads/accounts */
export async function list(_req: AuthRequest, res: Response): Promise<void> {
  try {
    res.json({ accounts: await listAccounts() });
  } catch (err: any) {
    fail(res, err, 'list ad accounts');
  }
}

/** PATCH /api/meta-ads/accounts/:id  { enabled } */
export async function toggle(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be true or false' });
      return;
    }
    res.json(await setEnabled(accountId(req), req.body.enabled));
  } catch (err: any) {
    fail(res, err, 'update the ad account');
  }
}

/** DELETE /api/meta-ads/accounts/:id */
export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    res.json(await deleteAccount(accountId(req)));
  } catch (err: any) {
    fail(res, err, 'disconnect the ad account');
  }
}
