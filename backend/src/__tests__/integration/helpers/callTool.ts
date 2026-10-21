import { prismaBase } from '../../../utils/prisma';
import { getTenantId } from '../../../utils/tenantContext';
import { runTool, ToolContext } from '../../../tools/registry';
import { toMcpResult } from '../../../mcp/utils';

/**
 * Call a registry tool as a test actor: the tenant's ai_agent user with every permission cell (super_admin), which
 * createTwoTenants makes as `ids.mcpUser`. A tenant that has none (the numbers fixture) gets one here. Channel mcp, no role filter.
 */
export async function toolActorContext(tenantId: string, channel: ToolContext['channel'] = 'mcp'): Promise<ToolContext> {
  const user =
    (await prismaBase.user.findFirst({ where: { tenantId, kind: 'ai_agent', role: 'super_admin' } })) ??
    (await prismaBase.user.create({
      data: { email: `tool-actor+${tenantId}@codadmin.test`, password: 'x', firstName: 'Tool', lastName: 'Actor', role: 'super_admin', kind: 'ai_agent', tenantId },
    }));
  return { tenantId, actorId: user.id, actorKind: 'ai_agent', roleId: null, channel };
}

/** The data a tool returns, as plain JSON (what an MCP client reads). Fails the test when the call is not ok. */
export async function toolData(name: string, args: Record<string, unknown>, tenantId: string): Promise<any> {
  const res = await runTool(name as never, args, await toolActorContext(tenantId));
  if (res.status !== 'ok') throw new Error(`${name} returned ${res.status}: ${(res as { error: string }).error}`);
  return JSON.parse(JSON.stringify(res.data));
}

/** The MCP-style result of a call in the current tenant context: { isError?, content: [{ text }] }. */
export async function toolMcpResult(name: string, args: unknown) {
  return toMcpResult(await runTool(name as never, args, await toolActorContext(getTenantId() as string)));
}

/** The tenant's audit rows for tool calls (all tools, or one), oldest first. */
export const toolAuditRows = (tenantId: string, tool?: string) =>
  prismaBase.auditLog.findMany({ where: { tenantId, resource: 'tool', ...(tool && { resourceId: tool }) }, orderBy: { id: 'asc' } });

/** How many audit rows for tool calls the tenant has (all tools, or one). */
export const toolAuditCount = (tenantId: string, tool?: string) =>
  prismaBase.auditLog.count({ where: { tenantId, resource: 'tool', ...(tool && { resourceId: tool }) } });
