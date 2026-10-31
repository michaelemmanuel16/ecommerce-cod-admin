import { NextFunction, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { auditService } from '../services/auditService';
import * as roleService from '../services/roleService';
import * as assignmentService from '../services/roleAssignmentService';
import * as permissionService from '../services/rolePermissionService';
import { clearPermissionsCache } from '../middleware/auth';
import { resolveTenantId } from '../utils/tenantContext';
import { formatIssues } from '../tools/shared';
import { assignSchema, createRoleSchema, setPermissionsSchema, setToolsSchema, updateRoleSchema } from '../validators/roleSchema';

/** An async handler whose errors go to the error middleware. */
const handler = (fn: (req: AuthRequest, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => { fn(req as AuthRequest, res).catch(next); };

const idParam = (raw: string, what = 'role'): number => {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(`Invalid ${what} ID`, 400);
  return id;
};

const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error, 'body'), 400, 'VALIDATION_ERROR');
  return parsed.data;
};

const actorOf = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });

/** Every role change writes an audit row. */
const audit = (req: AuthRequest, action: string, roleId: number, metadata: Record<string, unknown> = {}) =>
  auditService.recordFromRequest(req, { action, resource: 'role', resourceId: String(roleId), metadata });

/** GET /api/roles: the roles with tool and holder counts. */
export const list = handler(async (_req, res) => {
  res.json({ roles: await roleService.listRoles() });
});

/** GET /api/roles/overview: the role cards (holders with type tags, counts, this month's target). */
export const overview = handler(async (_req, res) => {
  res.json({ roles: await roleService.roleOverview() });
});

export const get = handler(async (req, res) => {
  res.json({ role: await roleService.getRole(idParam(req.params.id)) });
});

export const create = handler(async (req, res) => {
  const role = await roleService.createRole(resolveTenantId(), parse(createRoleSchema, req.body));
  await audit(req, 'role_create', role.id, { name: role.name, toolCount: role.toolCount });
  res.status(201).json({ role });
});

export const update = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const input = parse(updateRoleSchema, req.body);
  const role = await roleService.updateRole(actorOf(req), id, input);
  clearPermissionsCache(); // the base role decides the grid of a role that has none of its own
  await audit(req, 'role_update', id, { fields: Object.keys(input) });
  res.json({ role });
});

/** PUT /api/roles/:id/tools: `{tools: [...]}` replaces the switches. A write tool without its read tool is 400 ("Needs View orders"). */
export const setTools = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const { tools } = parse(setToolsSchema, req.body);
  const before = (await roleService.getRole(id)).tools;
  const role = await permissionService.setRoleTools(actorOf(req), id, tools);
  await audit(req, 'role_tools_update', id, { before, after: role.tools });
  res.json({ role });
});

/** GET /api/roles/:id/permissions: the grid of the role and the cells that may be set. */
export const getPermissions = handler(async (req, res) => {
  res.json(await permissionService.getRolePermissions(idParam(req.params.id)));
});

/** PUT /api/roles/:id/permissions: `{permissions: {resource: [actions]}}` replaces the grid. Clears the cache and tells the holders' browsers. */
export const setPermissions = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const { permissions } = parse(setPermissionsSchema, req.body);
  const { before, after } = await permissionService.setRolePermissions(actorOf(req), id, permissions);
  clearPermissionsCache();
  await audit(req, 'role_permissions_update', id, { before, after });
  const { getSocketInstance } = await import('../utils/socketInstance');
  const { emitPermissionsUpdated } = await import('../sockets');
  const io = getSocketInstance();
  if (io) emitPermissionsUpdated(io, await permissionService.holderBaseRoles(id));
  res.json({ permissions: after });
});

export const remove = handler(async (req, res) => {
  const id = idParam(req.params.id);
  await roleService.deleteRole(id);
  await audit(req, 'role_delete', id);
  res.json({ message: 'Role deleted' });
});

/** GET /api/roles/:id/assignments: current holders first, then the ended ones (history). */
export const assignments = handler(async (req, res) => {
  res.json({ assignments: await roleService.listAssignments(idParam(req.params.id)) });
});

/** POST /api/roles/:id/assign: `{type: existing | person | ai_agent | company, ...}`. An AI agent answers with its MCP key, shown once. */
export const assign = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const input = parse(assignSchema, req.body);
  const result = await assignmentService.assignToRole(actorOf(req), id, input);
  clearPermissionsCache();
  const apiKey = 'apiKey' in result ? result.apiKey : undefined;
  await audit(req, 'role_assign', id, {
    type: input.type, holderId: result.holder.id, assignmentId: result.assignment.id,
    // Only the prefix of a new key goes in; the raw key never does.
    ...(apiKey && { keyPrefix: apiKey.keyPrefix, keyId: apiKey.id }),
  });
  res.status(201).json(result);
});

/** DELETE /api/roles/:id/assignments/:assignmentId: ends the assignment today; the holder stays in history. */
export const unassign = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const assignmentId = idParam(req.params.assignmentId, 'assignment');
  const result = await assignmentService.unassign(actorOf(req), id, assignmentId);
  clearPermissionsCache();
  await audit(req, 'role_unassign', id, { assignmentId, holderId: result.assignment.holderId, revokedKeys: result.revokedKeys });
  res.json(result);
});
