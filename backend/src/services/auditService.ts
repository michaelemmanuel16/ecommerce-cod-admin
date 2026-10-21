import { AuditChannel, Prisma, UserKind } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { getTenantId, resolveTenantId, runInTenant } from '../utils/tenantContext';

/**
 * M2-T05: the one writer of tool and action audit rows. Rows are append-only: there is no
 * update or delete here except the retention purge, and the HTTP routes are read-only.
 */

export const AUDIT_RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS || '400', 10);

export const REDACTED = '[REDACTED]';

// Key names (lowercase, separators removed) whose value is always replaced.
const SECRET_KEY_PARTS = [
  'password', 'passwd', 'passphrase', 'secret', 'token', 'apikey', 'authorization', 'cookie',
  'credential', 'privatekey', 'accesskey', 'bearer', 'signature', 'sessionid',
];
// Short names that would match inside normal words, so they must match the whole key.
const SECRET_KEY_EXACT = new Set(['pwd', 'pin', 'otp', 'cvv', 'cvc', 'auth', 'key', 'jwt']);

// Token-looking values inside any string. Order matters: specific shapes first.
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, // JWT
  /\bmcp_[A-Za-z0-9]{16,}/g, // CodAdmin MCP key
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe / Paystack style
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g, // user:password@ in a URL
];
// Any long unbroken run that is hex, or has both letters and digits (base64, mixed keys), and is not a UUID.
const LONG_TOKEN = /[A-Za-z0-9_+/=-]{32,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_DEPTH = 8;
const MAX_STRING = 5000;

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_KEY_EXACT.has(k) || SECRET_KEY_PARTS.some((part) => k.includes(part));
}

export function redactString(value: string): string {
  if (value.length < 8) return value;
  let out = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  return out.replace(LONG_TOKEN, (run) => {
    if (UUID.test(run)) return run;
    return /^[0-9a-f]+$/i.test(run) || (/[A-Za-z]/.test(run) && /\d/.test(run)) ? REDACTED : run;
  });
}

/** Copy of `value` that is safe to store as JSON: secrets by key name and by value shape replaced. */
export function redactSecrets(value: unknown, depth = 0): Prisma.JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (depth >= MAX_DEPTH) return '[too deep]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactString(value.message);
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Decimal and other classes with toJSON serialise themselves
    if (typeof obj.toJSON === 'function') return redactSecrets((obj as { toJSON(): unknown }).toJSON(), depth + 1);
    const out: Record<string, Prisma.JsonValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || typeof v === 'function') continue;
      out[k] = isSecretKey(k) && v !== null && v !== '' ? REDACTED : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return null;
}

export type ToolCallStatus = 'ok' | 'denied' | 'invalid' | 'error';

export interface AuditRecordInput {
  /** Defaults to the tenant of the current context. */
  tenantId?: string;
  actorId?: number | null;
  actorKind?: UserKind | null;
  channel?: AuditChannel | null;
  roleId?: number | null;
  /** What happened, for example `tool_call`. */
  action: string;
  resource: string;
  resourceId?: string | null;
  /** Registry tool name (stored in metadata, and as resourceId when resource is `tool`). */
  tool?: string;
  status?: ToolCallStatus;
  durationMs?: number;
  input?: unknown;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  aiActionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function write(tenantId: string, p: AuditRecordInput) {
  const metadata: Record<string, unknown> = { ...p.metadata };
  if (p.tool !== undefined) metadata.tool = p.tool;
  if (p.status !== undefined) metadata.status = p.status;
  if (p.durationMs !== undefined) metadata.durationMs = p.durationMs;
  if (p.input !== undefined) metadata.input = p.input;
  const json = (v: unknown) => (v === undefined || v === null ? undefined : (redactSecrets(v) as Prisma.InputJsonValue));
  return prisma.auditLog.create({
    data: {
      tenantId,
      userId: p.actorId ?? null,
      actorKind: p.actorKind ?? null,
      channel: p.channel ?? null,
      roleId: p.roleId ?? null,
      action: p.action,
      resource: p.resource,
      resourceId: p.resourceId ?? null,
      metadata: redactSecrets(metadata) as Prisma.InputJsonValue,
      before: json(p.before),
      after: json(p.after),
      aiActionId: p.aiActionId ?? null,
      ipAddress: p.ipAddress ?? null,
      userAgent: p.userAgent ?? null,
    },
  });
}

export interface AuditListFilters {
  actorId?: number;
  channel?: AuditChannel;
  tool?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export const auditService = {
  /** Write one audit row. Input, before, after and metadata are redacted first. Throws if the write fails. */
  async record(p: AuditRecordInput) {
    const tenantId = resolveTenantId(p.tenantId);
    return tenantId === getTenantId() ? write(tenantId, p) : runInTenant(tenantId, () => write(tenantId, p));
  },

  /** Newest first, current tenant only (the Prisma extension adds the tenant filter). */
  async list(filters: AuditListFilters) {
    // page and limit are bounded by the controller's zod schema
    const { page = 1, limit = 50 } = filters;
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.actorId !== undefined && { userId: filters.actorId }),
      ...(filters.channel && { channel: filters.channel }),
      ...(filters.tool && { resource: 'tool', resourceId: filters.tool }),
      ...((filters.from || filters.to) && {
        createdAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lte: filters.to }) },
      }),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      prisma.auditLog.count({ where }),
    ]);
    return { logs: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },

  /**
   * Retention: delete rows of the CURRENT tenant older than `days`. Called by the nightly job inside
   * each tenant's context; this is the only delete path.
   */
  async purgeOlderThan(days: number = AUDIT_RETENTION_DAYS, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const BATCH = 1000;
    let total = 0;
    for (;;) {
      const rows = await prisma.auditLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take: BATCH });
      if (rows.length === 0) break;
      const { count } = await prisma.auditLog.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      total += count;
      if (rows.length < BATCH) break;
    }
    if (total > 0) logger.info(`[audit] retention removed ${total} rows older than ${cutoff.toISOString()}`);
    return total;
  },
};
