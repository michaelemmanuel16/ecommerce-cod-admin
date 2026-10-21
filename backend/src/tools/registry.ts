import { z, ZodError, ZodTypeAny } from 'zod';
import { TOOL_PERMISSIONS, ToolName } from '../config/toolPermissions';
import { AppError } from '../middleware/errorHandler';
import type { AuditChannel, UserKind } from '@prisma/client';
import { auditService, ToolCallStatus } from '../services/auditService';
import { actorHasPermission, roleAllowsTool } from '../services/toolAccessService';
import { runInTenant } from '../utils/tenantContext';
import logger from '../utils/logger';

/**
 * M2-T04: the tool registry. Every action by a person, an AI agent, a partner or the system goes
 * through runTool(), which gives one path for validation, access check, tenant context and audit.
 *
 * Tool files live in src/tools/ and may not import the Prisma client (ESLint, see .eslintrc.json):
 * they call service methods. Only files in src/tools/ may call registerToolDef (a test scans for it).
 */

/** Bump when a tool name, input schema or permission changes. */
export const REGISTRY_VERSION = '2026.10.1';

export type ToolKind = 'read' | 'write';

export interface ToolContext {
  tenantId: string;
  actorId: number;
  actorKind: UserKind;
  roleId: number | null;
  channel: AuditChannel;
}

/** A handler fills this to put more in the audit row (write tools: the row before and after). */
export interface AuditTrace {
  before?: unknown;
  after?: unknown;
  resourceId?: string;
}

export interface ToolDef<S extends ZodTypeAny = ZodTypeAny, R = unknown> {
  name: ToolName;
  description: string;
  input: S;
  handler: (input: z.infer<S>, ctx: ToolContext, trace: AuditTrace) => Promise<R> | R;
  kind: ToolKind;
  /** Permission cell. Always TOOL_PERMISSIONS[name]; defineTool fills it. */
  permission: string;
  /**
   * 'listed' (default): when the caller has a role, the role's `tools` list must contain this tool.
   * 'any': skip the role allow-list (the base permission still applies).
   */
  roleScope: 'listed' | 'any';
  /** 'preview': the caller must see a preview and confirm before the write runs (used from M12). */
  confirm: 'none' | 'preview';
  /** True when the output or effect carries money. */
  money: boolean;
}

/** What a tool file writes: the permission cell is not its choice, and the rest have defaults. */
export type ToolSpec<S extends ZodTypeAny, R> = Omit<ToolDef<S, R>, 'permission' | 'kind' | 'roleScope' | 'confirm' | 'money'> &
  Partial<Pick<ToolDef<S, R>, 'kind' | 'roleScope' | 'confirm' | 'money'>>;

/** Build a ToolDef: the permission cell always comes from TOOL_PERMISSIONS. */
export function defineTool<S extends ZodTypeAny, R>(spec: ToolSpec<S, R>): ToolDef<S, R> {
  return {
    kind: 'read',
    roleScope: 'listed',
    confirm: 'none',
    money: false,
    ...spec,
    permission: TOOL_PERMISSIONS[spec.name],
  };
}

const registry = new Map<ToolName, ToolDef>();

/** Add a tool to the registry. Call it only from src/tools/. */
export function registerToolDef(def: ToolDef<any, any>): void {
  if (registry.has(def.name)) throw new Error(`Tool "${def.name}" is already registered`);
  registry.set(def.name, def as ToolDef);
}

export function getTool(name: string): ToolDef | undefined {
  return registry.get(name as ToolName);
}

export function listTools(): ToolDef[] {
  return [...registry.values()];
}

export type ToolOutcome<R = unknown> =
  | { status: 'ok'; data: R }
  | { status: Exclude<ToolCallStatus, 'ok'>; error: string; issues?: z.ZodIssue[] };

export type ToolResult<R = unknown> = ToolOutcome<R> & { durationMs: number };

const GENERIC_ERROR = 'The tool failed. Try again or contact support.';

/** Access check: a reason string when the actor may not run the tool, otherwise null. */
async function authorize(def: ToolDef, ctx: ToolContext): Promise<{ shown: string; detail: string } | null> {
  const needsRole = def.roleScope === 'listed' && ctx.roleId !== null;
  const [permitted, listed] = await Promise.all([
    actorHasPermission(ctx.actorId, def.permission),
    needsRole ? roleAllowsTool(ctx.roleId as number, def.name) : true,
  ]);
  if (!permitted) return { shown: 'You do not have permission to use this tool.', detail: `missing permission ${def.permission}` };
  if (!listed) return { shown: 'Your role does not include this tool.', detail: `role ${ctx.roleId} does not list this tool` };
  return null;
}

/**
 * Status mapping:
 *  ok      handler returned
 *  invalid unknown tool, or input failed the zod schema (extra keys are dropped, so a planted tenantId never reaches the handler)
 *  denied  the actor's base role lacks the permission cell, or the role's tool list excludes the tool
 *  error   the handler threw (an AppError message is shown to the caller, any other message is hidden)
 * Every call writes one audit row, also denied and invalid ones. If that write fails the failure is
 * logged and the result is still returned: the action itself already ran.
 */
export async function runTool<R = unknown>(tool: ToolDef<any, R> | ToolName, rawInput: unknown, ctx: ToolContext): Promise<ToolResult<R>> {
  const started = Date.now();
  const def = typeof tool === 'string' ? (getTool(tool) as ToolDef<any, R> | undefined) : tool;
  const name = typeof tool === 'string' ? tool : tool.name;

  return runInTenant(ctx.tenantId, async () => {
    const trace: AuditTrace = {};
    let detail: string | undefined;

    const execute = async (): Promise<ToolOutcome<R>> => {
      if (!def) return { status: 'invalid', error: `Unknown tool "${name}"` };
      const parsed = def.input.safeParse(rawInput ?? {});
      if (!parsed.success) return { status: 'invalid', error: formatIssues(parsed.error), issues: parsed.error.issues };
      try {
        const denial = await authorize(def, ctx);
        if (denial) {
          detail = denial.detail;
          return { status: 'denied', error: denial.shown };
        }
      } catch (err) {
        // The permission lookup failed: never treat that as permission granted.
        detail = errorText(err);
        return { status: 'error', error: GENERIC_ERROR };
      }
      try {
        return { status: 'ok', data: await def.handler(parsed.data, ctx, trace) };
      } catch (err) {
        detail = errorText(err);
        return { status: 'error', error: err instanceof AppError ? err.message : GENERIC_ERROR };
      }
    };

    const result = { ...(await execute()), durationMs: Date.now() - started };

    try {
      await auditService.record({
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        actorKind: ctx.actorKind,
        channel: ctx.channel,
        roleId: ctx.roleId,
        action: 'tool_call',
        resource: 'tool',
        resourceId: name,
        tool: name,
        status: result.status,
        durationMs: result.durationMs,
        input: rawInput,
        before: trace.before,
        after: trace.after,
        metadata: {
          ...(def && { kind: def.kind, registryVersion: REGISTRY_VERSION }),
          ...(detail && { detail }),
          ...(trace.resourceId && { targetId: trace.resourceId }),
        },
      });
    } catch (err) {
      logger.error('[tools] failed to write the audit row', { tool: name, status: result.status, error: errorText(err) });
    }
    return result;
  });
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function formatIssues(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}
