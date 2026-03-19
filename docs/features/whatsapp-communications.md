# WhatsApp Business API Integration (MAN-29 + MAN-30)

## Overview

Automated WhatsApp messaging to customers on key order lifecycle events using Meta's WhatsApp Business Cloud API (Graph API v21.0).

## Architecture

```
Order event → Bull queue (messagingQueue) → WhatsApp Cloud API → Customer
                                         ↘ MessageLog (DB)

WhatsApp webhook → POST /api/whatsapp/webhook → Update MessageLog status
```

- **Async delivery**: Messages are enqueued via Bull/Redis with exponential backoff (3 attempts: 5s, 10s, 20s)
- **Graceful degradation**: If WhatsApp credentials aren't configured, messages are logged to `MessageLog` but not sent to the API
- **Audit trail**: Every message (sent or failed) is stored in `MessageLog` with status tracking (pending → sent → delivered → read)

## Auto-Triggered Messages

| Order Event | Template | Customer Sees |
|-------------|----------|---------------|
| Order created | `order_created` | "We've received your order #123! Total: GHS 150.00" |
| Status → confirmed | `order_confirmed` | "Your order #123 has been confirmed! Total: GHS 150.00" |
| Status → out_for_delivery | `order_out_for_delivery` | "Your order #123 is out for delivery! John is on the way." |
| Status → delivered | `order_delivered` | "Your order #123 has been delivered! Amount: GHS 150.00" |
| Status → failed_delivery | `order_delivery_failed` | "We were unable to deliver your order #123." |

Other statuses (preparing, ready_for_pickup, cancelled) can be triggered via the Workflows system.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/whatsapp/webhook` | None | WhatsApp webhook verification |
| POST | `/api/whatsapp/webhook` | None | Receive status updates & inbound messages |
| GET | `/api/whatsapp/messages` | Admin | List message logs (paginated, filterable) |
| GET | `/api/whatsapp/messages/:id` | Admin | Get single message log |
| POST | `/api/whatsapp/send` | Admin | Send manual WhatsApp text message |
| POST | `/api/whatsapp/test` | Admin | Send test template message |
| GET | `/api/whatsapp/stats` | Admin | Message delivery statistics |

## Environment Variables

```env
# Required for sending (optional in dev — messages logged but not sent)
WHATSAPP_ACCESS_TOKEN=           # Meta Graph API access token
WHATSAPP_PHONE_NUMBER_ID=        # WhatsApp Business phone number ID

# Required for webhook security (HMAC-SHA256 signature verification)
WHATSAPP_APP_SECRET=             # Meta App Secret — without this, webhooks are rejected
WHATSAPP_WEBHOOK_VERIFY_TOKEN=   # Custom token you set in Meta dashboard

# Optional
WHATSAPP_BUSINESS_ACCOUNT_ID=    # WhatsApp Business Account ID
```

## Meta Template Submission Guide

Submit these templates in the WhatsApp Business Manager at https://business.facebook.com → WhatsApp Manager → Message Templates.

**Category:** UTILITY (transactional, order-related)
**Language:** English (en)

---

### 1. `order_created`

**Header:** None
**Body:**
```
Hi {{1}}, we've received your order #{{2}}! Total: {{3}}. We'll confirm it shortly and keep you updated.
```
**Footer:** `Powered by COD Admin`
**Sample values:** `John`, `12345`, `GHS 150.00`

---

### 2. `order_confirmed`

**Header:** None
**Body:**
```
Hi {{1}}, your order #{{2}} has been confirmed! Total: {{3}}. We'll update you as it progresses.
```
**Footer:** `Powered by COD Admin`
**Sample values:** `John`, `12345`, `GHS 150.00`

---

### 3. `order_out_for_delivery`

**Header:** None
**Body:**
```
Hi {{1}}, your order #{{2}} is out for delivery! {{3}} is on the way.
```
**Footer:** `Powered by COD Admin`
**Sample values:** `John`, `12345`, `Kwame Asante`

---

### 4. `order_delivered`

**Header:** None
**Body:**
```
Hi {{1}}, your order #{{2}} has been delivered! Amount collected: {{3}}. Thank you for your purchase!
```
**Footer:** `Powered by COD Admin`
**Sample values:** `John`, `12345`, `GHS 150.00`

---

### 5. `order_delivery_failed`

**Header:** None
**Body:**
```
Hi {{1}}, we were unable to deliver your order #{{2}}. We'll contact you to reschedule.
```
**Footer:** `Powered by COD Admin`
**Sample values:** `John`, `12345`

## Database Model

```prisma
model MessageLog {
  id                Int              @id @default(autoincrement())
  orderId           Int?
  customerId        Int?
  channel           MessageChannel   // whatsapp | sms
  direction         MessageDirection // outbound | inbound
  templateName      String?
  messageBody       String
  status            MessageStatus    // pending | sent | delivered | read | failed
  providerMessageId String?          @unique
  errorMessage      String?
  metadata          Json?
  sentAt            DateTime?
  deliveredAt       DateTime?
  readAt            DateTime?
  createdAt         DateTime
  updatedAt         DateTime
}
```

## OAuth Integration (2026-03-19)

### Overview

Meta "Facebook Login for Business" OAuth flow allows admins to click "Connect with Meta" to authorize the app, automatically exchange tokens, and select their WhatsApp phone number from a picker. Manual entry remains as an alternative via a tabbed UI.

### OAuth Flow

```
Admin clicks "Connect with Meta" → POST /api/whatsapp/oauth/initiate
  → Backend generates CSRF state, returns authUrl
  → Browser opens Meta OAuth consent in new tab
  → Admin authorizes → Meta redirects to GET /api/whatsapp/oauth/callback
  → Backend validates state, exchanges code → short-lived → long-lived token (~60 days)
  → Backend fetches WABA phone numbers via debug_token + Graph API
  → Redirects to frontend /settings?oauth=success
  → Frontend fetches phone list, opens picker (auto-selects if single number)
  → Admin selects phone → POST /api/whatsapp/oauth/select
  → Backend persists config (encrypted), clears cache → done
```

### OAuth API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/whatsapp/oauth/initiate` | super_admin | Generate auth URL + CSRF state |
| GET | `/api/whatsapp/oauth/callback` | none (CSRF) | Meta redirect target, exchanges tokens |
| GET | `/api/whatsapp/oauth/phones` | super_admin | Fetch pending phone numbers |
| POST | `/api/whatsapp/oauth/select` | super_admin | Finalize phone selection |
| DELETE | `/api/whatsapp/oauth/disconnect` | super_admin | Clear OAuth, revert to manual |
| GET | `/api/whatsapp/oauth/enabled` | admin+ | Check if META_APP_ID configured |

### Token Refresh

- **Daily cron** at 01:00 — refreshes if within 7 days of expiry
- **On-demand guard** in dispatch — refreshes if within 1 day of expiry (fallback when cron fails)
- `isRefreshing` flag prevents concurrent refresh attempts

### Environment Variables

```env
META_APP_ID=<your-meta-app-id>          # Optional — OAuth disabled if absent
META_APP_SECRET=<your-meta-app-secret>  # Optional — OAuth disabled if absent
BACKEND_URL=http://localhost:3000       # For constructing OAuth redirect URI
```

### Extended whatsappProvider JSON Schema

```typescript
// New OAuth fields (no migration — JSON column)
authMode?: 'manual' | 'oauth';
wabaId?: string;
oauthTokenExpiry?: string;     // ISO 8601
oauthConnectedAt?: string;     // ISO 8601
oauthVerifiedName?: string;
oauthDisplayPhone?: string;
oauthUserId?: string;          // Meta user ID for refresh
```

### Key Files

| File | Purpose |
|------|---------|
| `backend/src/services/metaOAuthService.ts` | Meta Graph API interactions (new) |
| `backend/src/controllers/whatsappOAuthController.ts` | HTTP handlers + in-memory stores (new) |
| `backend/src/services/whatsappTokenRefreshService.ts` | Token refresh cron + on-demand (new) |
| `frontend/src/components/settings/integrations/WhatsAppOAuthButton.tsx` | Connect/disconnect button (new) |
| `frontend/src/components/settings/integrations/WhatsAppPhonePickerModal.tsx` | Phone picker modal (new) |
| `frontend/src/components/settings/integrations/WhatsAppIntegration.tsx` | Dual-mode tabbed UI (modified) |

## Testing

1. **Without API keys (dev):** Messages are logged to `MessageLog` with status `pending`. Verify via Prisma Studio or the `/api/whatsapp/messages` endpoint.
2. **With API keys (staging):** Use `POST /api/whatsapp/test` with `{ "to": "0241234567" }` to send a test message.
3. **Production:** Messages auto-send on order status changes. Monitor via `/api/whatsapp/stats`.
4. **OAuth flow:** Without META_APP_ID — OAuth tab shows disabled state. With META_APP_ID — "Connect with Meta" button initiates full OAuth flow.
