import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import crypto from 'crypto';
import { safeEqual } from '../utils/crypto';
import { parsePackageField } from '../utils/packageParser';
import { runInTenant, withoutTenant } from '../utils/tenantContext';
import { findAndReactivateCustomerByPhone } from '../utils/customerLookup';
import { normalizePhoneForStorage } from '../utils/phone';
import * as Money from '../utils/money';
import orderService from './orderService';


export const MIN_WEBHOOK_SECRET_LENGTH = 16;

/** Internal field names a mapping may fill. A mapped value for any other name goes to the order notes. */
const KNOWN_FIELDS = new Set([
  'customerPhone', 'alternativePhone', 'customerFirstName', 'customerLastName', 'customerEmail',
  'deliveryAddress', 'deliveryState', 'deliveryArea', 'notes', 'quantity', 'package', 'price',
  'subtotal', 'shippingCost', 'deliveryFee', 'totalAmount', 'productName',
]);

/** A secret or header value for the API: only the last 4 characters show. */
export const maskValue = (value: string): string => `${'*'.repeat(8)}${value.slice(-4)}`;

const maskHeaders = (headers: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries((headers as Record<string, unknown>) || {}).map(([k, v]) => [k, maskValue(String(v))]));

/** A config as the API shows it: the secret and every header value masked. */
const toApi = <T extends { secret?: string | null; headers?: unknown }>(config: T): T => ({
  ...config,
  secret: config.secret ? maskValue(config.secret) : config.secret,
  headers: maskHeaders(config.headers),
});

/** Headers to store: names and values must be text. A value that is the mask of the stored one is kept as stored. */
function cleanHeaders(input: unknown, stored: unknown): Record<string, string> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('Headers must be an object of header name to value.', 400, 'INVALID_HEADERS');
  }
  const current = new Map(Object.entries((stored as Record<string, unknown>) || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(input as Record<string, unknown>)) {
    if (!name.trim() || typeof value !== 'string' || !value) {
      throw new AppError(`Header "${name}" needs a name and a value.`, 400, 'INVALID_HEADERS');
    }
    const old = current.get(name.toLowerCase());
    out[name.trim()] = old !== undefined && value === maskValue(old) ? old : value;
  }
  return out;
}

function checkSecret(secret: unknown): string {
  if (typeof secret !== 'string' || secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    throw new AppError(`The secret must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters.`, 400, 'SECRET_TOO_SHORT');
  }
  return secret;
}

/**
 * Offset of the first character that makes `raw` invalid JSON (the end of text when it stops early), or -1 when it is
 * valid. Newer Node versions leave the position out of the JSON.parse message, so the place is found here.
 */
function firstJsonErrorOffset(raw: string): number {
  let i = 0;
  const ws = () => { while (i < raw.length && ' \t\n\r'.includes(raw[i])) i++; };
  const lit = (word: string) => {
    for (const ch of word) { if (raw[i] !== ch) return false; i++; }
    return true;
  };
  const str = (): boolean => {
    i++;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '"') { i++; return true; }
      if (ch < ' ') return false;
      if (ch === '\\') {
        i++;
        if (raw[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(raw.slice(i + 1, i + 5))) return false;
          i += 4;
        } else if (!'"\\/bfnrt'.includes(raw[i] ?? '')) return false;
      }
      i++;
    }
    return false;
  };
  const value = (): boolean => {
    ws();
    const ch = raw[i];
    if (ch === '{') {
      i++; ws();
      if (raw[i] === '}') { i++; return true; }
      for (;;) {
        ws();
        if (raw[i] !== '"' || !str()) return false;
        ws();
        if (raw[i] !== ':') return false;
        i++;
        if (!value()) return false;
        ws();
        if (raw[i] === ',') { i++; continue; }
        if (raw[i] === '}') { i++; return true; }
        return false;
      }
    }
    if (ch === '[') {
      i++; ws();
      if (raw[i] === ']') { i++; return true; }
      for (;;) {
        if (!value()) return false;
        ws();
        if (raw[i] === ',') { i++; continue; }
        if (raw[i] === ']') { i++; return true; }
        return false;
      }
    }
    if (ch === '"') return str();
    if (ch === 't') return lit('true');
    if (ch === 'f') return lit('false');
    if (ch === 'n') return lit('null');
    const num = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(raw.slice(i));
    if (!num) return false;
    i += num[0].length;
    return true;
  };
  if (!value()) return i;
  ws();
  return i < raw.length ? i : -1;
}

/** Where a JSON.parse error is: "line 3, column 7 (position 20)". Empty when it cannot be found. */
export function jsonErrorPlace(raw: string, message: string): string {
  const m = /position (\d+)/.exec(message);
  const found = m ? Number(m[1]) : firstJsonErrorOffset(raw);
  if (found < 0) return '';
  const pos = Math.min(found, raw.length);
  const before = raw.slice(0, pos);
  const line = before.split('\n').length;
  const column = pos - before.lastIndexOf('\n');
  return `line ${line}, column ${column} (position ${pos})`;
}

interface CreateWebhookData {
  name: string;
  url: string;
  secret: string;
  requireSignature?: boolean;
  apiKey?: string;
  productId?: number;
  fieldMapping: Record<string, string>;
  headers?: Record<string, string>;
}

interface ProcessWebhookData {
  signature?: string;
  apiKey?: string;
  body: any;
  headers: any;
  endpoint: string;
  method: string;
}

interface ProcessWebhookByUniqueUrlData {
  uniqueUrl: string;
  signature?: string;
  body: any;
  headers: any;
  endpoint: string;
  method: string;
}

export class WebhookService {
  /**
   * Get all webhook configurations
   */
  async getAllWebhooks() {

    const webhooks = await prisma.webhookConfig.findMany({
      where: {},
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        }
      }
    });

    return webhooks.map(toApi);
  }

  /**
   * Create new webhook configuration
   */
  async createWebhook(data: CreateWebhookData) {
    checkSecret(data.secret);
    const headers = data.headers === undefined ? {} : cleanHeaders(data.headers, {});

    const webhook = await prisma.webhookConfig.create({
      data: {
        name: data.name,
        url: data.url,
        secret: data.secret,
        requireSignature: data.requireSignature ?? false,
        apiKey: data.apiKey,
        productId: data.productId,
        fieldMapping: data.fieldMapping,
        headers,
      },
      include: {
        product: true
      }
    });

    logger.info('Webhook configuration created', {
      webhookId: webhook.id,
      name: webhook.name,
      productId: webhook.productId
    });

    return toApi(webhook);
  }

  /**
   * Get webhook by ID
   */
  async getWebhookById(webhookId: number) {

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id: webhookId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        },
        logs: {
          orderBy: { processedAt: 'desc' },
          take: 10
        }
      }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    return toApi(webhook);
  }

  /**
   * Update webhook configuration
   */
  async updateWebhook(webhookId: number, updateData: Partial<CreateWebhookData> & { isActive?: boolean }) {

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id: webhookId }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    // Only these fields change; the tenant, id and unique URL never come from the request.
    const data: Record<string, unknown> = {};
    for (const key of ['name', 'url', 'requireSignature', 'apiKey', 'productId', 'fieldMapping', 'isActive'] as const) {
      if (updateData[key] !== undefined) data[key] = updateData[key];
    }
    // The API shows a masked secret; sending it back unchanged keeps the stored one.
    if (updateData.secret !== undefined && updateData.secret !== maskValue(webhook.secret)) {
      data.secret = checkSecret(updateData.secret);
    }
    if (updateData.headers !== undefined) data.headers = cleanHeaders(updateData.headers, webhook.headers);

    const updated = await prisma.webhookConfig.update({
      where: { id: webhookId },
      data,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        }
      }
    });

    logger.info('Webhook configuration updated', { webhookId });
    return toApi(updated);
  }

  /**
   * Delete webhook configuration
   */
  async deleteWebhook(webhookId: number) {

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id: webhookId }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    await prisma.webhookConfig.delete({
      where: { id: webhookId }
    });

    logger.info('Webhook configuration deleted', { webhookId });
    return { message: 'Webhook deleted successfully' };
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(payload).digest('hex');
      const sig = signature.replace(/^sha256=/, '');
      return safeEqual(sig, digest);
    } catch (error) {
      logger.error('Signature verification failed', { error });
      return false;
    }
  }

  /**
   * Enforce signature verification for a webhook config that opts in
   * (requireSignature). When enabled, a missing signature header must NOT
   * bypass the check — that was the original fail-open bug. Default-off so
   * integrations that authenticate by API key / unique URL (e.g. WPForms,
   * which can't HMAC the body) keep working. Applied identically across every
   * webhook entry path so the two can't drift back into the bug.
   */
  private async enforceSignature(
    webhookLogId: number,
    config: { requireSignature?: boolean | null; secret: string } | null,
    signature: string | undefined,
    body: unknown
  ): Promise<void> {
    if (!config?.requireSignature) return;
    const isValid = !!signature && this.verifySignature(JSON.stringify(body), signature, config.secret);
    if (!isValid) {
      await this.updateWebhookLog(webhookLogId, {
        success: false,
        errorMessage: signature ? 'Invalid signature' : 'Missing signature',
        statusCode: 401
      });
      throw new AppError('Invalid webhook signature', 401);
    }
  }

  /**
   * The custom headers the sender must send (M9-T28). Names are case-insensitive, values are compared in
   * constant time. A config with no headers (every config made before this task) checks nothing.
   */
  private async enforceHeaders(webhookLogId: number, config: { headers?: unknown }, received: unknown): Promise<void> {
    const required = Object.entries((config.headers as Record<string, unknown>) || {});
    if (required.length === 0) return;
    const got = new Map(Object.entries((received as Record<string, unknown>) || {}).map(([k, v]) => [k.toLowerCase(), v]));
    for (const [name, expected] of required) {
      const value = got.get(name.toLowerCase());
      const sent = Array.isArray(value) ? value[0] : value;
      if (typeof sent !== 'string' || !safeEqual(sent, String(expected))) {
        await this.updateWebhookLog(webhookLogId, {
          success: false,
          errorMessage: typeof sent === 'string' ? `Wrong value for header ${name}` : `Missing header ${name}`,
          statusCode: 401
        });
        throw new AppError('Invalid webhook headers', 401);
      }
    }
  }

  /**
   * Process incoming webhook
   */
  async processWebhook(data: ProcessWebhookData) {
    const { signature, apiKey, body, headers, endpoint, method } = data;

    // Find the config first: the tenant comes from it. No key, no tenant, no import.
    const webhookConfig = apiKey
      ? await withoutTenant('webhook-import-api-key', () =>
        prisma.webhookConfig.findFirst({
          where: { apiKey, isActive: true }
        })
      )
      : null;

    if (!webhookConfig) {
      logger.warn('Webhook rejected: invalid API key', { endpoint });
      throw new AppError('Invalid API key', 401);
    }
    if (!webhookConfig.tenantId) {
      logger.warn('Webhook rejected: config has no tenant', { endpoint, webhookConfigId: webhookConfig.id });
      throw new AppError('Invalid API key', 401);
    }

    return this.processForConfig(webhookConfig, webhookConfig.tenantId, { signature, body, headers, endpoint, method });
  }

  /**
   * Process incoming webhook via unique URL
   */
  async processWebhookByUniqueUrl(data: ProcessWebhookByUniqueUrlData) {
    const { uniqueUrl, signature, body, headers, endpoint, method } = data;

    // Find webhook config by unique URL (include product relation). The log row needs its tenant.
    const webhookConfig = await withoutTenant('webhook-import-unique-url', () =>
      prisma.webhookConfig.findUnique({
        where: { uniqueUrl, isActive: true },
        include: {
          product: true
        }
      })
    );

    if (!webhookConfig) {
      logger.warn('Webhook rejected: invalid webhook URL', { endpoint });
      throw new AppError('Webhook not found', 404);
    }
    if (!webhookConfig.tenantId) {
      logger.warn('Webhook rejected: config has no tenant', { endpoint, webhookConfigId: webhookConfig.id });
      throw new AppError('Webhook not found', 404);
    }

    return this.processForConfig(webhookConfig, webhookConfig.tenantId, { signature, body, headers, endpoint, method });
  }

  /**
   * Shared tail of both webhook entry paths. The config was found by an unscoped
   * lookup (API key / unique URL) and has a tenant; from here everything runs inside it.
   */
  private async processForConfig(
    webhookConfig: any,
    tenantId: string,
    data: { signature: string | undefined; body: any; headers: unknown; endpoint: string; method: string },
    /** A retry replays a stored body for an admin: the sender's signature and headers are not there to check. */
    isRetry = false
  ) {
    const { signature, body, headers, endpoint, method } = data;
    return runInTenant(tenantId, async () => {
      const webhookLog = await this.createWebhookLog(webhookConfig, tenantId, { endpoint, method, headers, body });

      try {
        if (!isRetry) {
          await this.enforceSignature(webhookLog.id, webhookConfig, signature, body);
          await this.enforceHeaders(webhookLog.id, webhookConfig, headers);
        }

        const results = await this.processOrdersFromWebhook(body, webhookConfig);

        // Every order refused (and none skipped as a repeat) is a failed log, so it can be retried.
        const allFailed = results.failed > 0 && results.success === 0 && results.skipped === 0;
        await this.updateWebhookLog(webhookLog.id, {
          success: !allFailed,
          response: results,
          errorMessage: allFailed ? results.errors[0]?.error : undefined,
          statusCode: 200
        });

        return {
          message: 'Webhook processed',
          results,
          logId: webhookLog.id
        };
      } catch (error: any) {
        logger.error('Webhook processing error', {
          error: error.message,
          webhookLogId: webhookLog.id
        });

        await this.updateWebhookLog(webhookLog.id, {
          success: false,
          errorMessage: error.message,
          statusCode: error.statusCode || 500
        });

        throw error;
      }
    });
  }

  /**
   * Process orders from webhook payload
   */
  private getExternalId(order: any): string | undefined {
    const id = order.id || order.order_id;
    return id ? String(id) : undefined;
  }

  /**
   * Generate a unique fingerprint for webhook order deduplication.
   * Hash of (phone + totalAmount + date) prevents race-condition duplicates
   * via a DB unique constraint.
   */
  /** Money from an external payload field. Missing or invalid is zero. */
  private parseMoneyField(value: unknown): Money.Money {
    return Money.tryParse(typeof value === 'string' ? value.trim() : value) ?? Money.ZERO;
  }

  private generateWebhookFingerprint(phone: string, totalAmount: Money.Money, webhookConfigId?: number): string {
    const dateStr = new Date().toISOString().split('T')[0]; // same calendar day
    // Decimal.toString() prints 675 and 675.5 as the old number form did, so same-day fingerprints stay stable
    const raw = `${phone}|${totalAmount.toString()}|${webhookConfigId || ''}|${dateStr}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
  }

  private async processOrdersFromWebhook(body: any, webhookConfig: any) {
    const mapping = (webhookConfig?.fieldMapping as any) || {};
    const orders = Array.isArray(body.orders) ? body.orders : [body];

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [] as Array<{ order: any; error: string }>
    };

    // Guard 1 pre-fetch: collect all externalOrderIds in the batch and query once
    const batchExternalIds = orders
      .map((o: any) => this.getExternalId(o))
      .filter(Boolean) as string[];

    const existingExternalIdSet = new Set<string>();

    if (batchExternalIds.length > 0) {
      const existing = await prisma.order.findMany({
        where: { externalOrderId: { in: batchExternalIds }, deletedAt: null },
        select: { externalOrderId: true },
      });
      existing.forEach((o) => existingExternalIdSet.add(o.externalOrderId!));
    }

    for (const externalOrder of orders) {
      try {
        // Map external fields to internal fields
        const mappedData = this.mapFields(externalOrder, mapping);
        // Values the order has no field for. They go into the notes, so nothing the sender wrote is lost.
        const extraNotes = this.unmappedNotes(externalOrder, mapping);

        // The phone is the only required field. Say which one is missing.
        if (!(mappedData.customerPhone || externalOrder.customer_phone || externalOrder.phone)) {
          throw new Error(`Customer phone number is required, but the order has no value for the phone field "${mapping.customerPhone ?? 'customerPhone (not mapped)'}"`);
        }

        // Find or create customer
        const customer = await this.findOrCreateCustomer(mappedData, externalOrder);

        // Determine product, quantity, and price
        let product = null;
        let quantity = 1;
        let price: Money.Money = Money.ZERO;
        let packageInfo = '';

        // Check if webhook has a configured product (new flow)
        if (webhookConfig?.productId && webhookConfig?.product) {
          // Use webhook's configured product
          product = webhookConfig.product;

          // Parse package field to extract quantity and price
          const packageField = mappedData.quantity || mappedData.package || externalOrder.quantity || externalOrder.package || '';
          packageInfo = packageField;

          if (packageField) {
            const parsed = parsePackageField(packageField);
            quantity = parsed.quantity;
            price = Money.fromNumber(parsed.price);

            logger.info('Parsed package field', {
              packageField,
              quantity,
              price,
              productId: product.id
            });
          } else {
            // Fall back to explicit quantity/price fields if package field is empty
            quantity = Number(mappedData.quantity || externalOrder.quantity || 1);
            price = this.parseMoneyField(mappedData.price || externalOrder.price);
          }
        } else {
          // Old flow: Look up product by name (backward compatibility)
          const productName = mappedData.productName || externalOrder.product_name || externalOrder.product;
          quantity = Number(mappedData.quantity || externalOrder.quantity || 1);
          price = this.parseMoneyField(mappedData.price || externalOrder.price);
          packageInfo = mappedData.package || externalOrder.package || '';

          product = productName ? await this.findProductByName(productName) : null;
          if (productName && !product) extraNotes.push(`Product not matched: ${productName}`);
        }

        // Calculate totals
        // The parsed price from package field is the TOTAL price for the package, not per-unit
        // Example: "BUY THREE SETS - GH₵675" means 3 sets for 675 total (not 675 each)
        const itemTotal = price; // Use price as-is (it's already the total)
        const subtotal = mappedData.subtotal ? this.parseMoneyField(mappedData.subtotal) : itemTotal;
        const shippingCost = this.parseMoneyField(mappedData.shippingCost || mappedData.deliveryFee || externalOrder.shipping_cost || externalOrder.delivery_fee);
        const totalAmount = Money.roundHalfUp(
          mappedData.totalAmount ? this.parseMoneyField(mappedData.totalAmount) : Money.add(subtotal, shippingCost)
        );

        // Guard 1: exact-retry deduplication by externalOrderId (in-memory lookup from pre-fetch)
        const externalId = this.getExternalId(externalOrder);
        if (externalId && existingExternalIdSet.has(externalId)) {
          logger.info('Skipping duplicate webhook order (same externalOrderId)', {
            externalOrderId: externalId,
          });
          results.skipped++;
          continue;
        }

        // Guard 2: DB-level fingerprint deduplication (phone + amount + day + webhookConfig)
        // Uses a unique constraint on webhookFingerprint to prevent race-condition duplicates
        const fingerprint = this.generateWebhookFingerprint(
          customer.phoneNumber,
          totalAmount,
          webhookConfig?.id
        );

        // Also check in-memory for orders already created in this batch
        if (existingExternalIdSet.has(`fp:${fingerprint}`)) {
          logger.info('Skipping duplicate webhook order (same fingerprint in batch)', {
            phone: customer.phoneNumber,
            totalAmount: Money.toApi(totalAmount),
          });
          results.skipped++;
          continue;
        }

        // Create the order through the order service (stock, region, customer totals, events)
        const baseNotes = mappedData.notes || externalOrder.notes || (packageInfo ? `Package: ${packageInfo}` : undefined);
        const notes = [baseNotes, ...extraNotes].filter(Boolean).join('\n') || undefined;
        let createdOrder;
        try {
          createdOrder = await orderService.createOrder({
            customerId: customer.id,
            orderItems: product ? [{
              productId: product.id,
              quantity,
              unitPrice: quantity > 0 ? Money.roundHalfUp(Money.div(price, quantity), 4) : price,
            }] : [],
            subtotal,
            shippingCost,
            totalAmount,
            deliveryAddress: mappedData.deliveryAddress || externalOrder.address || customer.address || '',
            deliveryState: mappedData.deliveryState || externalOrder.state || customer.state || '',
            deliveryArea: mappedData.deliveryArea || externalOrder.area || customer.area || '',
            notes,
            webhook: { externalOrderId: externalId, data: externalOrder, fingerprint },
          });
        } catch (err: any) {
          // P2002 = unique constraint violation — another concurrent request already created this order
          if (err.code === 'P2002' && err.meta?.target?.includes('webhook_fingerprint')) {
            logger.info('Skipping duplicate webhook order (concurrent fingerprint collision)', {
              phone: customer.phoneNumber,
              totalAmount: Money.toApi(totalAmount),
              fingerprint,
            });
            results.skipped++;
            continue;
          }
          throw err; // Re-throw non-dedup errors
        }

        // Track fingerprint in-memory for remaining items in this batch
        existingExternalIdSet.add(`fp:${fingerprint}`);

        results.success++;
        logger.info('Webhook order created', { orderId: createdOrder.id });
      } catch (err: any) {
        results.failed++;
        results.errors.push({
          order: externalOrder,
          error: err.message
        });
        logger.error('Failed to process webhook order', {
          error: err.message,
          orderData: externalOrder
        });
      }
    }

    return results;
  }

  /**
   * Map external fields to internal fields
   */
  private mapFields(externalData: any, mapping: Record<string, string>): any {
    const mappedData: any = {};

    for (const [internalField, externalField] of Object.entries(mapping)) {
      if (externalData[externalField] !== undefined) {
        mappedData[internalField] = externalData[externalField];
      }
    }

    return mappedData;
  }

  /** "field: value" lines for mapped values whose internal field is not one the order knows. */
  private unmappedNotes(externalData: any, mapping: Record<string, string>): string[] {
    return Object.entries(mapping)
      .filter(([internal, external]) => !KNOWN_FIELDS.has(internal) && externalData[external] !== undefined && externalData[external] !== '')
      .map(([internal, external]) => `${internal}: ${typeof externalData[external] === 'object' ? JSON.stringify(externalData[external]) : externalData[external]}`);
  }

  /**
   * Find product by name or SKU (case-insensitive). No match is null: the caller keeps the text in the notes.
   */
  private async findProductByName(productName: string): Promise<any> {

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { name: { equals: productName, mode: 'insensitive' } },
          { sku: { equals: productName, mode: 'insensitive' } }
        ],
              }
    });

    return product;
  }

  /**
   * Find or create customer from webhook data
   */
  private async findOrCreateCustomer(mappedData: any, externalOrder: any) {
    const rawPhone = mappedData.customerPhone || externalOrder.customer_phone || externalOrder.phone;

    if (!rawPhone) {
      throw new Error('Customer phone number is required');
    }
    // Stored normalized; unparseable input stays as sent (a real order must not fail on it).
    const customerPhone = normalizePhoneForStorage(String(rawPhone));
    const rawAlternate = mappedData.alternativePhone || externalOrder.alternative_phone_number;


    let customer = await findAndReactivateCustomerByPhone(prisma, customerPhone, 'webhook intake');

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          firstName: mappedData.customerFirstName || externalOrder.customer_name || 'Unknown',
          lastName: mappedData.customerLastName || '',
          phoneNumber: customerPhone,
          alternatePhone: rawAlternate ? normalizePhoneForStorage(String(rawAlternate)) : undefined,
          email: mappedData.customerEmail || externalOrder.email || undefined,
          address: mappedData.deliveryAddress || externalOrder.address || '',
          state: mappedData.deliveryState || externalOrder.state || '',
          area: mappedData.deliveryArea || externalOrder.area || '',
                  }
      });

      logger.info('Customer created from webhook', {
        customerId: customer.id,
        phoneNumber: customerPhone
      });
    }

    return customer;
  }

  /** The sender's headers for the log row, with the values of credentials masked: the config's custom headers, the key and the signature. */
  private redactHeaders(headers: unknown, config: { headers?: unknown }): unknown {
    if (!headers || typeof headers !== 'object') return headers;
    const secret = new Set(['x-api-key', 'x-webhook-signature', 'authorization', ...Object.keys((config.headers as object) || {}).map((k) => k.toLowerCase())]);
    return Object.fromEntries(Object.entries(headers as Record<string, unknown>)
      .map(([k, v]) => [k, secret.has(k.toLowerCase()) && typeof v === 'string' ? maskValue(v) : v]));
  }

  /**
   * Create the log row, in the tenant of the webhook config.
   */
  private async createWebhookLog(
    webhookConfig: { id: number; headers?: unknown },
    tenantId: string,
    data: { endpoint: string; method: string; headers: unknown; body: unknown }
  ): Promise<{ id: number }> {
    return prisma.webhookLog.create({
      data: {
        // M9-T28: link retryOfId/orderId after schema merge
        tenantId,
        webhookConfigId: webhookConfig.id,
        endpoint: data.endpoint,
        method: data.method,
        headers: this.redactHeaders(data.headers, webhookConfig) as any,
        body: data.body as any,
        success: false,
      }
    });
  }

  private async updateWebhookLog(
    logId: number,
    data: {
      success: boolean;
      response?: any;
      errorMessage?: string;
      statusCode?: number;
    }
  ) {
    return prisma.webhookLog.update({
      where: { id: logId },
      data: {
        success: data.success,
        response: data.response as any,
        errorMessage: data.errorMessage,
        statusCode: data.statusCode
      }
    });
  }

  /** The config in the caller's tenant, or 404. Another tenant's config is a 404 too. */
  private async requireConfig(webhookId: number) {
    const webhook = await prisma.webhookConfig.findUnique({ where: { id: webhookId } });
    if (!webhook) throw new AppError('Webhook not found', 404);
    return webhook;
  }

  /**
   * A request whose body is not JSON. Writes a failed log row in the tenant of the webhook it was sent to,
   * and returns the 400 message with the place of the parse error. A URL or key that matches no webhook
   * writes nothing and is a 404 (no tenant to own the row).
   */
  async recordInvalidJson(data: {
    uniqueUrl?: string;
    apiKey?: string;
    rawBody: string;
    parseMessage: string;
    headers: unknown;
    endpoint: string;
    method: string;
  }): Promise<{ status: number; message: string }> {
    const config = await withoutTenant('webhook-invalid-json', () =>
      data.uniqueUrl
        ? prisma.webhookConfig.findUnique({ where: { uniqueUrl: data.uniqueUrl, isActive: true } })
        : data.apiKey
          ? prisma.webhookConfig.findFirst({ where: { apiKey: data.apiKey, isActive: true } })
          : null
    );
    if (!config?.tenantId) {
      return data.uniqueUrl
        ? { status: 404, message: 'Webhook not found' }
        : { status: 401, message: 'Invalid API key' };
    }
    const place = jsonErrorPlace(data.rawBody, data.parseMessage);
    const message = `Invalid JSON: ${data.parseMessage}${place ? ` at ${place}` : ''}`;
    await runInTenant(config.tenantId, async () => {
      const log = await this.createWebhookLog(config, config.tenantId as string, {
        endpoint: data.endpoint,
        method: data.method,
        headers: data.headers,
        body: { __invalidJson: true, raw: data.rawBody.slice(0, 10000) },
      });
      await this.updateWebhookLog(log.id, { success: false, errorMessage: message, statusCode: 400 });
    });
    return { status: 400, message };
  }

  /**
   * Get webhook logs
   */
  async getWebhookLogs(
    webhookId: number,
    filters?: { page?: number; limit?: number }
  ) {
    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;
    await this.requireConfig(webhookId);

    const [logs, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where: { webhookConfigId: webhookId },
        skip,
        take: limit,
        orderBy: { processedAt: 'desc' }
      }),
      prisma.webhookLog.count({
        where: { webhookConfigId: webhookId }
      })
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Test webhook field mapping. Maps the sample and shows the result. Reads only: no order, no customer, no log row.
   * `sampleData` is the sample object, or its JSON text (a text that does not parse is a 400 with the place of the error).
   */
  async testWebhook(webhookId: number, sampleData: any) {
    const webhook = await this.requireConfig(webhookId);

    let sample = sampleData;
    if (typeof sampleData === 'string') {
      try {
        sample = JSON.parse(sampleData);
      } catch (err: any) {
        const place = jsonErrorPlace(sampleData, err.message);
        throw new AppError(`Invalid JSON: ${err.message}${place ? ` at ${place}` : ''}`, 400, 'INVALID_JSON');
      }
    }
    if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) {
      throw new AppError('Send one sample order as a JSON object.', 400, 'INVALID_SAMPLE');
    }

    const mapping = webhook.fieldMapping as any;
    const mappedData = this.mapFields(sample, mapping);
    const hasPhone = Boolean(mappedData.customerPhone || sample.customer_phone || sample.phone);

    return {
      message: hasPhone ? 'Webhook test successful' : 'Webhook test: the customer phone number is missing',
      mappedData,
      unmappedNotes: this.unmappedNotes(sample, mapping),
      missingRequired: hasPhone ? [] : ['customerPhone'],
      sampleData: sample
    };
  }

  /**
   * Retry a failed log. The stored body is processed again under the same webhook; the result is a NEW log
   * row and the old one stays. A success is a 409. A request that was refused for its signature or headers
   * (401) is not replayed: that would let a forged request in. `webhookId` ties the log to the URL's webhook.
   */
  async retryWebhook(logId: number, webhookId?: number) {
    const log = await prisma.webhookLog.findUnique({
      where: { id: logId },
      include: {
        webhookConfig: { include: { product: true } }
      }
    });

    if (!log || (webhookId !== undefined && log.webhookConfigId !== webhookId)) {
      throw new AppError('Webhook log not found', 404);
    }
    if (log.success) {
      throw new AppError('Cannot retry a successful webhook', 409, 'ALREADY_SUCCEEDED');
    }
    if (log.statusCode === 401) {
      throw new AppError('A request refused for its signature or headers cannot be retried. The sender must send it again.', 409, 'AUTH_REFUSED');
    }
    const body = log.body as any;
    if (body?.__invalidJson) {
      throw new AppError('The original body was not valid JSON. The sender must send it again.', 409, 'INVALID_JSON');
    }
    if (!log.webhookConfig?.tenantId) {
      throw new AppError('Webhook not found', 404);
    }

    return this.processForConfig(
      log.webhookConfig,
      log.webhookConfig.tenantId,
      { signature: undefined, body, headers: log.headers, endpoint: log.endpoint, method: log.method },
      true
    );
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats(webhookId: number, filters?: { days?: number }) {
    const { days = 30 } = filters || {};
    await this.requireConfig(webhookId);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [totalLogs, successLogs, failedLogs, recentLogs] = await Promise.all([
      prisma.webhookLog.count({
        where: {
          webhookConfigId: webhookId,
          processedAt: { gte: startDate }
        }
      }),
      prisma.webhookLog.count({
        where: {
          webhookConfigId: webhookId,
          success: true,
          processedAt: { gte: startDate }
        }
      }),
      prisma.webhookLog.count({
        where: {
          webhookConfigId: webhookId,
          success: false,
          processedAt: { gte: startDate }
        }
      }),
      prisma.webhookLog.findMany({
        where: {
          webhookConfigId: webhookId,
          processedAt: { gte: startDate }
        },
        select: {
          processedAt: true,
          success: true
        },
        orderBy: { processedAt: 'desc' }
      })
    ]);

    return {
      totalRequests: totalLogs,
      successfulRequests: successLogs,
      failedRequests: failedLogs,
      successRate: totalLogs > 0 ? (successLogs / totalLogs) * 100 : 0,
      recentActivity: recentLogs
    };
  }
}

export default new WebhookService();
