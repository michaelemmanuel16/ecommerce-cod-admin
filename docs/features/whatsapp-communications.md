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

# Required for webhook verification
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

## Testing

1. **Without API keys (dev):** Messages are logged to `MessageLog` with status `pending`. Verify via Prisma Studio or the `/api/whatsapp/messages` endpoint.
2. **With API keys (staging):** Use `POST /api/whatsapp/test` with `{ "to": "0241234567" }` to send a test message.
3. **Production:** Messages auto-send on order status changes. Monitor via `/api/whatsapp/stats`.
