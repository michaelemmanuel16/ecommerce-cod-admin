# Webhook Integration Guide

Complete guide to integrating webhooks with the E-Commerce COD Admin Dashboard.

## Table of Contents

- [Introduction](#introduction)
- [Webhook Basics](#webhook-basics)
- [Shopify Integration](#shopify-integration)
- [WooCommerce Integration](#woocommerce-integration)
- [Custom Webhooks](#custom-webhooks)
- [Security](#security)
- [Testing Webhooks](#testing-webhooks)
- [Webhook Logs](#webhook-logs)
- [Error Handling](#error-handling)
- [Troubleshooting](#troubleshooting)

## Introduction

Webhooks allow external systems to send real-time data to your dashboard. This enables automatic order import from e-commerce platforms like Shopify and WooCommerce.

### Benefits

- **Real-Time Sync**: Orders appear instantly
- **Automation**: No manual data entry
- **Scalability**: Handle high order volumes
- **Reliability**: Built-in retry mechanisms

## Webhook Basics

### How Webhooks Work

```
External System → HTTP POST → Your Webhook → Order Created
(Shopify/WooCommerce)     (Your Dashboard)    (In System)
```

### Webhook Payload

Standard webhook request:

```http
POST /api/webhooks/shopify
Content-Type: application/json
X-Shopify-Topic: orders/create
X-Shopify-Hmac-SHA256: base64_encoded_signature

{
  "order": {
    "id": 123456,
    "customer": {...},
    "line_items": [...]
  }
}
```

## Shopify Integration

### Setup Steps

**1. Get Your Webhook URL**

```
https://api.yourdomain.com/api/webhooks/shopify
```

**2. Generate Webhook Secret**

```bash
# Generate a random secret
openssl rand -base64 32
```

Save this secret in your `.env` file:

```env
SHOPIFY_WEBHOOK_SECRET=your_generated_secret_here
```

**3. Configure in Shopify Admin**

1. Go to Settings → Notifications → Webhooks
2. Click "Create webhook"
3. Configure:
   - **Event**: Orders/Create
   - **Format**: JSON
   - **URL**: Your webhook URL
   - **API Version**: Latest stable

**4. Add Webhook Secret to Shopify**

In webhook settings, add your secret for HMAC verification.

### Shopify Webhook Events

**Available Events:**

| Event | Description |
|-------|-------------|
| `orders/create` | New order created |
| `orders/updated` | Order updated |
| `orders/cancelled` | Order cancelled |
| `orders/fulfilled` | Order fulfilled |
| `orders/paid` | Order payment confirmed |

### Shopify Payload Example

```json
{
  "id": 820982911946154508,
  "email": "customer@example.com",
  "created_at": "2025-10-08T10:00:00-04:00",
  "updated_at": "2025-10-08T10:00:00-04:00",
  "total_price": "299.00",
  "subtotal_price": "299.00",
  "total_tax": "0.00",
  "currency": "USD",
  "financial_status": "pending",
  "customer": {
    "id": 115310627314723954,
    "email": "customer@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "phone": "+1234567890"
  },
  "billing_address": {
    "first_name": "John",
    "last_name": "Doe",
    "address1": "123 Main St",
    "city": "New York",
    "province": "NY",
    "country": "United States",
    "zip": "10001"
  },
  "shipping_address": {
    "first_name": "John",
    "last_name": "Doe",
    "address1": "123 Main St",
    "city": "New York",
    "province": "NY",
    "country": "United States",
    "zip": "10001"
  },
  "line_items": [
    {
      "id": 466157049,
      "product_id": 632910392,
      "variant_id": 49148385,
      "title": "Product Name",
      "quantity": 2,
      "price": "149.50",
      "sku": "PROD-001"
    }
  ]
}
```

### Backend Webhook Handler

```typescript
// routes/webhooks.ts
import { Router } from 'express';
import crypto from 'crypto';
import { ShopifyService } from '../services/shopify.service';

const router = Router();
const shopifyService = new ShopifyService();

router.post('/shopify', async (req, res) => {
  try {
    // Verify HMAC signature
    const hmac = req.headers['x-shopify-hmac-sha256'] as string;
    const verified = verifyShopifyWebhook(req.body, hmac);
    
    if (!verified) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Get webhook topic
    const topic = req.headers['x-shopify-topic'] as string;

    // Process webhook
    switch (topic) {
      case 'orders/create':
        await shopifyService.createOrder(req.body);
        break;
      case 'orders/updated':
        await shopifyService.updateOrder(req.body);
        break;
      default:
        console.log(`Unhandled topic: ${topic}`);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Shopify webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

function verifyShopifyWebhook(data: any, hmac: string): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET!;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(data))
    .digest('base64');
  return hash === hmac;
}

export default router;
```

## WooCommerce Integration

### Setup Steps

**1. Install WooCommerce Webhooks**

Webhooks are built into WooCommerce 3.0+

**2. Get Your Webhook URL**

```
https://api.yourdomain.com/api/webhooks/woocommerce
```

**3. Configure in WordPress Admin**

1. Go to WooCommerce → Settings → Advanced → Webhooks
2. Click "Add webhook"
3. Configure:
   - **Name**: Order Created
   - **Status**: Active
   - **Topic**: Order created
   - **Delivery URL**: Your webhook URL
   - **Secret**: Generate a secret key
   - **API Version**: Latest

**4. Save Secret**

Add to `.env`:

```env
WOOCOMMERCE_WEBHOOK_SECRET=your_secret_here
```

### WooCommerce Webhook Events

| Event | Description |
|-------|-------------|
| `order.created` | New order |
| `order.updated` | Order updated |
| `order.deleted` | Order deleted |
| `order.restored` | Order restored |

### WooCommerce Payload Example

```json
{
  "id": 123,
  "parent_id": 0,
  "status": "processing",
  "currency": "USD",
  "date_created": "2025-10-08T10:00:00",
  "total": "299.00",
  "billing": {
    "first_name": "John",
    "last_name": "Doe",
    "address_1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postcode": "10001",
    "country": "US",
    "email": "customer@example.com",
    "phone": "+1234567890"
  },
  "shipping": {
    "first_name": "John",
    "last_name": "Doe",
    "address_1": "123 Main St",
    "city": "New York",
    "state": "NY",
    "postcode": "10001",
    "country": "US"
  },
  "line_items": [
    {
      "id": 1,
      "name": "Product Name",
      "product_id": 456,
      "quantity": 2,
      "subtotal": "299.00",
      "total": "299.00",
      "sku": "PROD-001"
    }
  ]
}
```

### Backend Handler

```typescript
router.post('/woocommerce', async (req, res) => {
  try {
    // Verify signature
    const signature = req.headers['x-wc-webhook-signature'] as string;
    const verified = verifyWooCommerceWebhook(req.body, signature);
    
    if (!verified) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Get event type
    const topic = req.headers['x-wc-webhook-topic'] as string;

    // Process webhook
    const wooService = new WooCommerceService();
    
    switch (topic) {
      case 'order.created':
        await wooService.createOrder(req.body);
        break;
      case 'order.updated':
        await wooService.updateOrder(req.body);
        break;
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('WooCommerce webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

function verifyWooCommerceWebhook(data: any, signature: string): boolean {
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET!;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(data))
    .digest('base64');
  return hash === signature;
}
```

## Custom Webhooks

### Creating Custom Webhook Endpoints

```typescript
// routes/webhooks.ts
router.post('/custom/:endpoint', async (req, res) => {
  try {
    const { endpoint } = req.params;
    
    // Verify webhook configuration exists
    const webhook = await prisma.webhook.findFirst({
      where: { endpoint, active: true }
    });

    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Verify signature if secret is set
    if (webhook.secret) {
      const signature = req.headers['x-webhook-signature'] as string;
      const verified = verifyCustomWebhook(req.body, signature, webhook.secret);
      
      if (!verified) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Process webhook data
    await processCustomWebhook(webhook, req.body);

    // Log webhook
    await logWebhook({
      webhookId: webhook.id,
      payload: req.body,
      status: 'success'
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Custom webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

### Webhook Management API

```typescript
// Create webhook configuration
router.post('/webhooks/config', authenticate, async (req, res) => {
  const { name, endpoint, events, secret } = req.body;
  
  const webhook = await prisma.webhook.create({
    data: {
      name,
      endpoint,
      events,
      secret,
      active: true
    }
  });
  
  res.status(201).json({ data: webhook });
});

// List webhooks
router.get('/webhooks/config', authenticate, async (req, res) => {
  const webhooks = await prisma.webhook.findMany();
  res.json({ data: webhooks });
});
```

## Security

### HMAC Verification

**Why HMAC?**
- Verify webhook authenticity
- Prevent tampering
- Ensure data integrity

**Implementation:**

```typescript
function verifyHMAC(
  payload: any,
  signature: string,
  secret: string,
  algorithm: string = 'sha256'
): boolean {
  const hash = crypto
    .createHmac(algorithm, secret)
    .update(JSON.stringify(payload))
    .digest('base64');
  
  // Use timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(signature)
  );
}
```

### Best Practices

1. **Always Verify Signatures**
   - Never trust webhook data without verification
   - Use HMAC or similar mechanism

2. **Use HTTPS**
   - Webhooks should only be sent over HTTPS
   - Configure SSL certificates

3. **Implement Rate Limiting**
   ```typescript
   const webhookLimiter = rateLimit({
     windowMs: 1 * 60 * 1000,
     max: 10
   });
   
   router.post('/webhooks/:platform', webhookLimiter, handler);
   ```

4. **Validate Payload**
   ```typescript
   const webhookSchema = z.object({
     id: z.string(),
     event: z.string(),
     data: z.record(z.any())
   });
   
   webhookSchema.parse(req.body);
   ```

5. **Use IP Whitelisting**
   ```typescript
   const allowedIPs = [
     '192.168.1.1',
     '10.0.0.1'
   ];
   
   if (!allowedIPs.includes(req.ip)) {
     return res.status(403).json({ error: 'Forbidden' });
   }
   ```

## Testing Webhooks

### Using Webhook.site

1. Go to https://webhook.site
2. Copy your unique URL
3. Use as webhook URL during development
4. View incoming requests in real-time

### Using cURL

```bash
# Test webhook endpoint
curl -X POST https://api.yourdomain.com/api/webhooks/shopify \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: orders/create" \
  -H "X-Shopify-Hmac-SHA256: signature" \
  -d '{
    "id": 123,
    "email": "test@example.com",
    "total_price": "100.00"
  }'
```

### Using Postman

1. Create new POST request
2. Set URL to webhook endpoint
3. Add headers (topic, signature)
4. Add JSON body
5. Send request

### Local Testing with ngrok

```bash
# Install ngrok
npm install -g ngrok

# Start your local server
npm run dev

# Expose to internet
ngrok http 5000

# Use ngrok URL for webhooks
https://abc123.ngrok.io/api/webhooks/shopify
```

## Webhook Logs

### Logging Implementation

```typescript
async function logWebhook(data: {
  webhookId: string;
  payload: any;
  status: 'success' | 'failed';
  error?: string;
}) {
  await prisma.webhookLog.create({
    data: {
      webhookId: data.webhookId,
      payload: JSON.stringify(data.payload),
      status: data.status,
      error: data.error,
      timestamp: new Date()
    }
  });
}
```

### Viewing Logs

```typescript
// Get webhook logs
router.get('/webhooks/:id/logs', authenticate, async (req, res) => {
  const logs = await prisma.webhookLog.findMany({
    where: { webhookId: req.params.id },
    orderBy: { timestamp: 'desc' },
    take: 100
  });
  
  res.json({ data: logs });
});
```

## Error Handling

### Retry Logic

```typescript
async function processWebhookWithRetry(
  webhook: any,
  payload: any,
  maxRetries: number = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await processWebhook(webhook, payload);
      return;
    } catch (error) {
      console.error(`Webhook processing failed (attempt ${attempt}):`, error);
      
      if (attempt === maxRetries) {
        await logWebhook({
          webhookId: webhook.id,
          payload,
          status: 'failed',
          error: error.message
        });
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, attempt) * 1000)
      );
    }
  }
}
```

### Error Responses

```typescript
// Success
res.status(200).json({ success: true });

// Bad Request
res.status(400).json({ 
  error: 'Invalid payload',
  details: validationErrors 
});

// Unauthorized
res.status(401).json({ 
  error: 'Invalid signature' 
});

// Server Error
res.status(500).json({ 
  error: 'Internal server error' 
});
```

## Troubleshooting

### Common Issues

**Webhook Not Receiving Data**

Check:
- Is URL correct and accessible?
- Is SSL certificate valid?
- Are firewall rules blocking requests?
- Is webhook active in platform settings?

**Signature Verification Failing**

Check:
- Is secret correct in both systems?
- Are you using correct algorithm (SHA256)?
- Is payload being modified before verification?

**Orders Not Creating**

Check:
- Webhook logs for errors
- Database connection
- Required fields in payload
- Validation rules

### Debug Mode

Enable detailed logging:

```typescript
if (process.env.WEBHOOK_DEBUG === 'true') {
  console.log('Webhook received:', {
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
}
```

---

**For more information:**
- [API Documentation](API_DOCUMENTATION.md)
- [Security Guide](SECURITY_GUIDE.md)

**Last Updated:** 2025-10-08
