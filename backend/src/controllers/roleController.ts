import { auditService } from '../services/auditService';
import * as roleService from '../services/roleService';
import * as assignmentService from '../services/roleAssignmentService';
import * as permissionService from '../services/rolePermissionService';
import { resolveTenantId } from '../utils/tenantContext';
import { AuthRequest } from '../types';
import { actorOf, handler, idParam, parse } from './helpers';
import { assignSchema, createRoleSchema, setPermissionsSchema, setToolsSchema, updateRoleSchema } from '../validators/roleSchema';

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
  await audit(req, 'role_update', id, { fields: Object.keys(input) });
  res.json({ role });
});

/** PUT /api/roles/:id/tools: `{tools: [...]}` replaces the switches. A write tool without its read tool is 400 ("Needs View orders"). */
export const setTools = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const { tools } = parse(setToolsSchema, req.body);
  const { role, before } = await permissionService.setRoleTools(actorOf(req), id, tools);
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
  await audit(req, 'role_permissions_update', id, { before, after });
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
  await audit(req, 'role_unassign', id, { assignmentId, holderId: result.assignment.holderId, revokedKeys: result.revokedKeys });
  res.json(result);
});
