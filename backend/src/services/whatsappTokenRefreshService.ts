import cron from 'node-cron';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { refreshLongLivedToken, isOAuthConfigured, tokenFallbackExpiry, getRedirectUri } from './metaOAuthService';
import { encryptProviderSecrets, decryptProviderSecrets } from '../utils/providerCrypto';
import { clearWhatsAppConfigCache } from './whatsappService';

let isRefreshing = false;

const REFRESH_BUFFER_DAYS = 7;

/**
 * Refresh the WhatsApp OAuth token if it's within 7 days of expiry.
 * Uses an `isRefreshing` flag to prevent concurrent refresh attempts.
 */
export async function refreshTokenIfNeeded(): Promise<{
  refreshed: boolean;
  newExpiresAt?: string;
  error?: string;
}> {
  if (!isOAuthConfigured()) {
    return { refreshed: false };
  }

  if (isRefreshing) {
    return { refreshed: false, error: 'Refresh already in progress' };
  }

  isRefreshing = true;
  try {
    const config = await prisma.systemConfig.findFirst({
      select: { id: true, whatsappProvider: true },
    });

    if (!config) {
      return { refreshed: false, error: 'No system config found' };
    }

    const provider = decryptProviderSecrets('whatsappProvider', config.whatsappProvider as any);
    if (!provider || provider.authMode !== 'oauth' || !provider.accessToken) {
      return { refreshed: false };
    }

    const expiry = provider.oauthTokenExpiry ? new Date(provider.oauthTokenExpiry) : null;
    if (!expiry) {
      return { refreshed: false };
    }

    const bufferMs = REFRESH_BUFFER_DAYS * 24 * 60 * 60 * 1000;
    const needsRefresh = expiry.getTime() - Date.now() < bufferMs;

    if (!needsRefresh) {
      logger.info('WhatsApp OAuth token still valid', {
        expiresAt: expiry.toISOString(),
        daysRemaining: Math.round((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      });
      return { refreshed: false };
    }

    logger.info('Refreshing WhatsApp OAuth token', {
      currentExpiry: expiry.toISOString(),
    });

    const result = await refreshLongLivedToken(provider.accessToken);

    const updatedProvider = {
      ...provider,
      accessToken: result.accessToken,
      oauthTokenExpiry: result.expiresAt || tokenFallbackExpiry(),
    };

    const encrypted = encryptProviderSecrets('whatsappProvider', updatedProvider);
    await prisma.systemConfig.update({
      where: { id: config.id },
      data: { whatsappProvider: encrypted },
    });

    clearWhatsAppConfigCache();

    logger.info('WhatsApp OAuth token refreshed successfully');

    return { refreshed: true, newExpiresAt: updatedProvider.oauthTokenExpiry };
  } catch (error: any) {
    logger.error('WhatsApp OAuth token refresh failed', { error: error.message });
    return { refreshed: false, error: error.message };
  } finally {
    isRefreshing = false;
  }
}

/**
 * Schedule daily token refresh cron at 01:00 AM.
 */
export function scheduleTokenRefresh(): void {
  if (!isOAuthConfigured()) {
    logger.info('META_APP_ID not configured — WhatsApp token refresh cron not scheduled');
    return;
  }

  // Validate BACKEND_URL so OAuth redirect URI issues are caught at startup
  const redirectUri = getRedirectUri();
  logger.info('WhatsApp OAuth redirect URI', { redirectUri });

  cron.schedule('0 1 * * *', async () => {
    logger.info('Running scheduled WhatsApp OAuth token refresh...');
    const result = await refreshTokenIfNeeded();
    if (result.refreshed) {
      logger.info('Scheduled token refresh completed');
    } else if (result.error) {
      logger.error('Scheduled token refresh failed', { error: result.error });
    } else {
      logger.info('Scheduled token refresh: no refresh needed');
    }
  });

  logger.info('WhatsApp OAuth token refresh cron scheduled (daily at 01:00)');
}
