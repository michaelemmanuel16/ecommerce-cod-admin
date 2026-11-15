import { Response } from 'express';
import { AuthRequest } from '../types';
import logger from '../utils/logger';
import {
  generateAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchUserIdFromToken,
  fetchWABAPhoneNumbers,
  subscribeWABAToApp,
  revokeToken,
  getRedirectUri,
  isOAuthConfigured,
  tokenFallbackExpiry,
  WABAPhoneNumber,
} from '../services/metaOAuthService';
import { adminService } from '../services/adminService';
import { clearWhatsAppConfigCache } from '../services/whatsappService';
import { encryptProviderSecrets, decryptProviderSecrets } from '../utils/providerCrypto';
import prisma from '../utils/prisma';
import { getTenantId } from '../utils/tenantContext';
import { sweepOAuthState } from '../utils/oauthState';
import { whatsappOAuthStore } from '../utils/whatsappOAuthState';

/** Where a login that lost its state starts again (M9-T27). */
const startAgainUrl = (frontendUrl: string) => `${frontendUrl}/connections?error=start_again`;

// Cleanup expired entries periodically
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

export function startCleanupInterval(): void {
  if (cleanupIntervalId) return;
  cleanupIntervalId = setInterval(() => {
    sweepOAuthState(); // the Meta Ads login state; the WhatsApp state expires in Redis
  }, 60_000);
}

export function stopCleanupInterval(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

// Start cleanup only in non-test environments
if (process.env.NODE_ENV !== 'test') {
  startCleanupInterval();
}

/**
 * POST /api/whatsapp/oauth/initiate
 * Generate Meta OAuth URL with CSRF state. owner and admin only.
 */
export async function initiateOAuth(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!isOAuthConfigured()) {
      res.status(400).json({ error: 'Meta OAuth not configured. Set META_APP_ID and META_APP_SECRET.' });
      return;
    }

    const userId = req.user!.id;
    const tenantId = getTenantId();
    if (!tenantId) {
      res.status(400).json({ error: 'A store is required' });
      return;
    }
    const state = await whatsappOAuthStore().createState(tenantId, userId);

    const redirectUri = getRedirectUri();
    const authUrl = generateAuthUrl(redirectUri, state);

    logger.info('WhatsApp OAuth initiated', { userId });
    res.json({ authUrl });
  } catch (error: any) {
    logger.error('Failed to initiate WhatsApp OAuth', { error: error.message });
    res.status(500).json({ error: 'Failed to initiate OAuth' });
  }
}

/**
 * GET /api/whatsapp/oauth/callback
 * Meta redirects here after admin authorizes. No JWT auth (unauthenticated route).
 * Validates CSRF state, exchanges code for tokens, fetches phone numbers,
 * stores pending data, then redirects to frontend.
 */
export async function handleOAuthCallback(req: AuthRequest, res: Response): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  try {
    const { code, state, error: oauthError, error_description } = req.query as Record<string, string>;

    if (oauthError) {
      logger.warn('OAuth callback received error from Meta');
      const msg = (error_description || oauthError).substring(0, 200);
      res.redirect(`${frontendUrl}/connections?oauth=error&message=${encodeURIComponent(msg)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}/connections?oauth=error&message=${encodeURIComponent('Missing code or state')}`);
      return;
    }

    // Consume CSRF state immediately to prevent replay attacks. It lives in Redis, so a restart in between does not lose it.
    const storedState = await whatsappOAuthStore().consumeState(state);

    if (!storedState) {
      logger.warn('OAuth callback: invalid or expired CSRF state');
      res.redirect(startAgainUrl(frontendUrl));
      return;
    }

    const { userId, tenantId } = storedState;

    // Exchange code for short-lived token
    const redirectUri = getRedirectUri();
    const { accessToken: shortToken } = await exchangeCodeForToken(code, redirectUri);

    // Exchange short-lived for long-lived token (~60 days)
    const { accessToken: longToken, expiresAt: tokenExpiry } = await exchangeForLongLivedToken(shortToken);

    // Fetch user ID and phone numbers
    const metaUserId = await fetchUserIdFromToken(longToken);
    const phones = await fetchWABAPhoneNumbers(metaUserId, longToken);

    // Store the pending login (10 minutes, in Redis, the token encrypted)
    await whatsappOAuthStore().savePending(tenantId, userId, {
      accessToken: longToken,
      oauthTokenExpiry: tokenExpiry || tokenFallbackExpiry(),
      oauthUserId: metaUserId,
      phones,
    });

    logger.info('WhatsApp OAuth callback successful', { userId, phoneCount: phones.length });
    res.redirect(`${frontendUrl}/connections?oauth=success`);
  } catch (error: any) {
    logger.error('WhatsApp OAuth callback failed', { error: error.message });
    res.redirect(`${frontendUrl}/connections?oauth=error&message=${encodeURIComponent('OAuth failed. Please try again.')}`);
  }
}

/**
 * GET /api/whatsapp/oauth/phones
 * Fetch pending phone numbers after OAuth callback. owner and admin only.
 */
export async function getPhoneNumbers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const pending = await whatsappOAuthStore().getPending(getTenantId() ?? '', req.user!.id);

    if (!pending) {
      res.status(404).json({ error: 'No pending OAuth session. Please initiate OAuth again.' });
      return;
    }

    res.json({ phones: pending.phones });
  } catch (error: any) {
    logger.error('Failed to get OAuth phone numbers', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch phone numbers' });
  }
}

/**
 * POST /api/whatsapp/oauth/select
 * Finalize phone number selection and persist OAuth config. owner and admin only.
 * Body: { phoneNumberId, displayPhone, verifiedName, wabaId? }
 */
export async function selectPhoneNumber(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const loginTenantId = getTenantId() ?? '';
    const pending = await whatsappOAuthStore().getPending(loginTenantId, userId);

    if (!pending) {
      res.status(404).json({ error: 'No pending OAuth session. Please initiate OAuth again.' });
      return;
    }

    const { phoneNumberId, wabaId } = req.body;
    if (!phoneNumberId) {
      res.status(400).json({ error: 'phoneNumberId is required' });
      return;
    }

    // Verify selected phone is in the pending list
    const selectedPhone = (pending.phones as WABAPhoneNumber[]).find(p => p.id === phoneNumberId);
    if (!selectedPhone) {
      res.status(400).json({ error: 'Selected phone number not found in authorized accounts' });
      return;
    }

    // Read existing config to preserve non-OAuth fields
    const config = await prisma.systemConfig.findFirst();
    if (!config) {
      res.status(500).json({ error: 'System config not found' });
      return;
    }

    const existingProvider = (config.whatsappProvider as any) || {};

    // Build new provider config — OAuth writes accessToken directly
    const newProvider = {
      ...existingProvider,
      accessToken: pending.accessToken,
      phoneNumberId,
      isEnabled: true,
      authMode: 'oauth' as const,
      wabaId: wabaId || existingProvider.wabaId,
      oauthTokenExpiry: pending.oauthTokenExpiry,
      oauthConnectedAt: new Date().toISOString(),
      oauthVerifiedName: selectedPhone.verified_name,
      oauthDisplayPhone: selectedPhone.display_phone_number,
      oauthUserId: pending.oauthUserId,
    };

    // Encrypt and save
    const encrypted = encryptProviderSecrets('whatsappProvider', newProvider);
    await prisma.systemConfig.update({
      where: { id: config.id },
      data: { whatsappProvider: encrypted },
    });

    clearWhatsAppConfigCache();
    await whatsappOAuthStore().deletePending(loginTenantId, userId);

    // Subscribe WABA to this app so Meta sends webhook events (delivery receipts)
    const effectiveWabaId = wabaId || existingProvider.wabaId;
    if (effectiveWabaId) {
      const subscribed = await subscribeWABAToApp(effectiveWabaId, pending.accessToken);
      if (!subscribed) {
        logger.warn('WABA webhook subscription failed — delivery receipts may not work', { wabaId: effectiveWabaId });
      }
    } else {
      logger.warn('No WABA ID available — skipping webhook subscription. Delivery receipts require manual setup.');
    }

    logger.info('WhatsApp OAuth phone selected and config saved', { userId, phoneNumberId });

    // Audit log
    await adminService.createAuditLog(
      req.user!,
      'oauth_connect',
      'whatsapp_provider',
      phoneNumberId,
      { verifiedName: selectedPhone.verified_name, displayPhone: selectedPhone.display_phone_number }
    );

    res.json({
      success: true,
      verifiedName: selectedPhone.verified_name,
      displayPhone: selectedPhone.display_phone_number,
    });
  } catch (error: any) {
    logger.error('Failed to select OAuth phone number', { error: error.message });
    res.status(500).json({ error: 'Failed to save phone selection' });
  }
}

/**
 * DELETE /api/whatsapp/oauth/disconnect
 * Clear OAuth fields, revert to manual mode. owner and admin only.
 */
export async function disconnectOAuth(req: AuthRequest, res: Response): Promise<void> {
  try {
    const config = await prisma.systemConfig.findFirst();
    if (!config) {
      res.status(500).json({ error: 'System config not found' });
      return;
    }

    const existingProvider = decryptProviderSecrets('whatsappProvider', (config.whatsappProvider as any) || {});

    // Revoke token on Meta's side (best-effort, don't block on failure)
    if (existingProvider.accessToken && existingProvider.authMode === 'oauth') {
      revokeToken(existingProvider.accessToken).catch((err: any) => {
        logger.warn('Failed to revoke Meta OAuth token', { error: err.message });
      });
    }

    // Destructure out OAuth-specific fields, keep everything else
    const {
      wabaId: _wabaId,
      oauthTokenExpiry: _oauthTokenExpiry,
      oauthConnectedAt: _oauthConnectedAt,
      oauthVerifiedName: _oauthVerifiedName,
      oauthDisplayPhone: _oauthDisplayPhone,
      oauthUserId: _oauthUserId,
      ...rest
    } = existingProvider;

    const updatedProvider = {
      ...rest,
      accessToken: '',
      phoneNumberId: '',
      isEnabled: false,
      authMode: 'manual' as const,
    };

    const encrypted = encryptProviderSecrets('whatsappProvider', updatedProvider);
    await prisma.systemConfig.update({
      where: { id: config.id },
      data: { whatsappProvider: encrypted },
    });

    clearWhatsAppConfigCache();

    logger.info('WhatsApp OAuth disconnected', { userId: req.user!.id });

    await adminService.createAuditLog(req.user!, 'oauth_disconnect', 'whatsapp_provider');

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to disconnect WhatsApp OAuth', { error: error.message });
    res.status(500).json({ error: 'Failed to disconnect' });
  }
}

/**
 * GET /api/whatsapp/oauth/enabled
 * Check if META_APP_ID is configured (admin+ can check).
 */
export async function checkOAuthEnabled(_req: AuthRequest, res: Response): Promise<void> {
  res.json({ enabled: isOAuthConfigured() });
}
