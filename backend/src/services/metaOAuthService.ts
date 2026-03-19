import logger from '../utils/logger';

export const GRAPH_API_VERSION = 'v21.0';
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const OAUTH_SCOPES = 'whatsapp_business_management,whatsapp_business_messaging';

/** Fallback token lifetime when Meta doesn't return expires_in */
export const LONG_LIVED_TOKEN_FALLBACK_DAYS = 60;

export function tokenFallbackExpiry(): string {
  return new Date(Date.now() + LONG_LIVED_TOKEN_FALLBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export interface WABAPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  code_verification_status?: string;
}

interface TokenExchangeResult {
  accessToken: string;
  expiresIn?: number;
  expiresAt?: string; // ISO 8601
}

function getMetaAppId(): string {
  const id = process.env.META_APP_ID;
  if (!id) throw new Error('META_APP_ID not configured');
  return id;
}

function getMetaAppSecret(): string {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error('META_APP_SECRET not configured');
  return secret;
}

export function getRedirectUri(): string {
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
  return `${backendUrl}/api/whatsapp/oauth/callback`;
}

export function isOAuthConfigured(): boolean {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function generateAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getMetaAppId(),
    redirect_uri: redirectUri,
    state,
    scope: OAUTH_SCOPES,
    response_type: 'code',
  });
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<TokenExchangeResult> {
  const params = new URLSearchParams({
    client_id: getMetaAppId(),
    client_secret: getMetaAppSecret(),
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    logger.error('Meta OAuth token exchange failed', { status: response.status, body });
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = await response.json() as any;
  // expires_in intentionally ignored — this short-lived token is immediately
  // exchanged for a long-lived token via exchangeForLongLivedToken()
  return { accessToken: data.access_token };
}

/**
 * Exchange a token for a long-lived token (~60 days).
 * Used both for initial short→long exchange and for refreshing existing long-lived tokens.
 */
async function exchangeToken(fbExchangeToken: string, logContext: string): Promise<TokenExchangeResult> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: getMetaAppId(),
    client_secret: getMetaAppSecret(),
    fb_exchange_token: fbExchangeToken,
  });

  const response = await fetch(`${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`);
  if (!response.ok) {
    const body = await response.text();
    logger.error(`Meta ${logContext} failed`, { status: response.status, body });
    throw new Error(`${logContext} failed: ${response.status}`);
  }

  const data = await response.json() as any;
  const expiresIn = data.expires_in as number | undefined;
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : undefined;

  return {
    accessToken: data.access_token,
    expiresIn,
    expiresAt,
  };
}

export function exchangeForLongLivedToken(shortToken: string): Promise<TokenExchangeResult> {
  return exchangeToken(shortToken, 'long-lived token exchange');
}

export function refreshLongLivedToken(currentToken: string): Promise<TokenExchangeResult> {
  return exchangeToken(currentToken, 'token refresh');
}

export async function revokeToken(token: string): Promise<void> {
  const response = await fetch(`${GRAPH_API_BASE}/me/permissions?access_token=${token}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    logger.warn('Meta token revocation failed', { status: response.status });
  }
}

export async function fetchUserIdFromToken(token: string): Promise<string> {
  const response = await fetch(`${GRAPH_API_BASE}/me?access_token=${token}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch user ID: ${response.status}`);
  }
  const data = await response.json() as any;
  return data.id;
}

function mapPhone(phone: any): WABAPhoneNumber {
  return {
    id: phone.id,
    display_phone_number: phone.display_phone_number,
    verified_name: phone.verified_name,
    quality_rating: phone.quality_rating || 'UNKNOWN',
    code_verification_status: phone.code_verification_status,
  };
}

async function fetchPhonesForWabas(wabas: any[], token: string): Promise<WABAPhoneNumber[]> {
  const results = await Promise.all(
    wabas.map(async (waba: any) => {
      const res = await fetch(`${GRAPH_API_BASE}/${waba.id}/phone_numbers?access_token=${token}`);
      if (!res.ok) {
        logger.warn('Failed to fetch phones for WABA', { wabaId: waba.id, status: res.status });
        return [];
      }
      const data = await res.json() as any;
      return (data.data || []).map(mapPhone);
    })
  );
  return results.flat();
}

export async function fetchWABAPhoneNumbers(userId: string, token: string): Promise<WABAPhoneNumber[]> {
  // Strategy 1: Use debug_token to find granted WABA IDs from the OAuth consent
  logger.info('Fetching granted assets via debug_token');
  try {
    const appToken = `${getMetaAppId()}|${getMetaAppSecret()}`;
    const debugResponse = await fetch(
      `${GRAPH_API_BASE}/debug_token?input_token=${token}&access_token=${appToken}`
    );
    if (debugResponse.ok) {
      const debugData = await debugResponse.json() as any;
      const granularScopes = debugData.data?.granular_scopes || [];
      logger.info('debug_token granular_scopes', { scopes: JSON.stringify(granularScopes) });

      // Extract WABA IDs from whatsapp_business_management scope
      const wbmScope = granularScopes.find(
        (s: any) => s.scope === 'whatsapp_business_management'
      );
      const wabaIds: string[] = wbmScope?.target_ids || [];

      if (wabaIds.length > 0) {
        logger.info('Found granted WABA IDs', { wabaIds });
        const wabas = wabaIds.map(id => ({ id }));
        const phones = await fetchPhonesForWabas(wabas, token);
        if (phones.length > 0) return phones;
      }
    } else {
      const body = await debugResponse.text();
      logger.warn('debug_token failed', { status: debugResponse.status, body });
    }
  } catch (err: any) {
    logger.warn('debug_token lookup error', { error: err.message });
  }

  // Strategy 2: Use shared WABA endpoint
  logger.info('Trying shared WABA endpoint');
  const sharedResponse = await fetch(
    `${GRAPH_API_BASE}/${userId}/shared_whatsapp_business_accounts?access_token=${token}`
  );
  if (sharedResponse.ok) {
    const sharedData = await sharedResponse.json() as any;
    const wabas = sharedData.data || [];
    if (wabas.length > 0) {
      const phones = await fetchPhonesForWabas(wabas, token);
      if (phones.length > 0) return phones;
    }
  } else {
    logger.warn('Shared WABA lookup failed', { status: sharedResponse.status });
  }

  // Strategy 3: Direct WABA lookup via /me
  logger.info('Trying direct WABA approach via /me endpoint');
  const directResponse = await fetch(
    `${GRAPH_API_BASE}/me/whatsapp_business_accounts?access_token=${token}`
  );
  if (directResponse.ok) {
    const directData = await directResponse.json() as any;
    const wabas = directData.data || [];
    if (wabas.length > 0) {
      const phones = await fetchPhonesForWabas(wabas, token);
      if (phones.length > 0) return phones;
    }
  } else {
    logger.warn('Direct WABA lookup failed', { status: directResponse.status });
  }

  // Strategy 4: Business-based lookup (requires business_management permission)
  logger.info('Trying business-based WABA lookup');
  const businessResponse = await fetch(
    `${GRAPH_API_BASE}/${userId}/businesses?access_token=${token}`
  );
  if (businessResponse.ok) {
    const businessData = await businessResponse.json() as any;
    const businesses = businessData.data || [];
    const allPhones = (await Promise.all(
      businesses.map(async (business: any) => {
        const wabaRes = await fetch(
          `${GRAPH_API_BASE}/${business.id}/owned_whatsapp_business_accounts?access_token=${token}`
        );
        if (!wabaRes.ok) return [];
        const wabaData = await wabaRes.json() as any;
        return fetchPhonesForWabas(wabaData.data || [], token);
      })
    )).flat();
    if (allPhones.length > 0) return allPhones;
  } else {
    logger.warn('Business lookup failed', { status: businessResponse.status });
  }

  return [];
}
