import { z, ZodError, ZodTypeAny } from 'zod';
import { TOOL_PERMISSIONS, ToolName } from '../config/toolPermissions';
import { AppError } from '../middleware/errorHandler';
import type { AuditChannel, UserKind } from '@prisma/client';
import { auditService, ToolCallStatus } from '../services/auditService';
import { AccessFacts, loadAccessFacts, permittedCells } from '../services/toolAccessService';
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
  /** The actor's base role and the role's tool list, when the caller already holds them (the MCP key cache). Otherwise runTool loads them. */
  access?: AccessFacts;
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
  /** Channels that may call the tool. Default: all. A call from any other channel is refused as "not available". */
  allowedChannels?: readonly AuditChannel[];
}

/** What a tool file writes: the permission cell is not its choice, and the rest have defaults. */
export type ToolSpec<S extends ZodTypeAny, R> = Omit<ToolDef<S, R>, 'permission' | 'kind' | 'roleScope' | 'confirm' | 'money'> &
  Partial<Pick<ToolDef<S, R>, 'kind' | 'roleScope' | 'confirm' | 'money' | 'allowedChannels'>>;

/** Build a ToolDef: the permission cell always comes from TOOL_PERMISSIONS. */
export function defineTool<S extends ZodTypeAny, R>(spec: ToolSpec<S, R>): ToolDef<S, R> {
  return {
    kind: 'read',
    roleScope: 'listed',
    confirm: 'none',
    money: false,
    // A write tool is offered to the MCP channel only until a tool says otherwise (chat and cards get writes in M12).
    ...(spec.kind === 'write' ? { allowedChannels: ['mcp'] as const } : {}),
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

type Denial = { shown: string; detail: string };

/** The channel part of the access decision. It needs no lookup, so runTool checks it before it reads the input. */
function channelDenial(def: ToolDef, channel: AuditChannel): Denial | null {
  if (def.allowedChannels && !def.allowedChannels.includes(channel)) {
    return { shown: `The tool ${def.name} is not available from ${channel}.`, detail: `channel ${channel} not allowed` };
  }
  return null;
}

/**
 * The one access decision: the stricter of the actor's base role and the role's tool list, on top of the channel.
 * Pure: the lookups are done by the caller (see accessOf).
 */
function decide(def: ToolDef, channel: AuditChannel, facts: AccessFacts, permitted: ReadonlySet<string>): Denial | null {
  const byChannel = channelDenial(def, channel);
  if (byChannel) return byChannel;
  if (!permitted.has(def.permission)) return { shown: 'You do not have permission to use this tool.', detail: `missing permission ${def.permission}` };
  if (def.roleScope === 'listed' && facts.roleTools !== null && !facts.roleTools.includes(def.name)) {
    return { shown: 'Your role does not include this tool.', detail: `the role does not list ${def.name}` };
  }
  return null;
}

/** Load what the decision needs for these tools, once. Run in the caller's tenant context. */
async function accessOf(ctx: ToolContext, defs: ToolDef[]) {
  const facts = ctx.access ?? (await loadAccessFacts(ctx.actorId, ctx.roleId));
  const permitted = await permittedCells(facts.baseRole, defs.map((d) => d.permission));
  return { facts, permitted };
}

/**
 * Access check: null when the actor may run the tool, otherwise the reason. runTool uses it for every call.
 * Run it in the caller's tenant context.
 */
export async function checkToolAccess(def: ToolDef, ctx: ToolContext): Promise<Denial | null> {
  const { facts, permitted } = await accessOf(ctx, [def]);
  return decide(def, ctx.channel, facts, permitted);
}

/** The tools this actor may run: tools/list uses it. One load of the actor's facts, then the decision for every tool in memory. */
export async function allowedTools(ctx: ToolContext, defs: ToolDef[] = listTools()): Promise<ToolDef[]> {
  const { facts, permitted } = await accessOf(ctx, defs);
  return defs.filter((def) => decide(def, ctx.channel, facts, permitted) === null);
}

/**
 * Status mapping:
 *  ok      handler returned
 *  invalid unknown tool, or input failed the zod schema (extra keys are dropped, so a planted tenantId never reaches the handler)
 *  denied  the actor's base role lacks the permission cell, the role's tool list excludes the tool, or the tool is
 *          not available on the call's channel (allowedChannels; the message says "not available")
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
      const wrongChannel = channelDenial(def, ctx.channel);
      if (wrongChannel) {
        detail = wrongChannel.detail;
        return { status: 'denied', error: wrongChannel.shown };
      }
      const parsed = def.input.safeParse(rawInput ?? {});
      if (!parsed.success) return { status: 'invalid', error: formatIssues(parsed.error), issues: parsed.error.issues };
      try {
        const denial = await checkToolAccess(def, ctx);
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
