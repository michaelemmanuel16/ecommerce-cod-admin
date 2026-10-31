/** M6-T03: the pure rules of the role API (input schemas, holder status) and the position role of a new user. */
import { describe, it, expect, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { assignSchema, createRoleSchema, updateRoleSchema } from '../../validators/roleSchema';
import { holderStatus } from '../../services/roleService';
import { assignPositionRole } from '../../services/systemRoleService';
import { runInTenant } from '../../utils/tenantContext';
import { ROLE_NAME_BY_USER_ROLE } from '../../config/defaultRoles';

describe('roleSchema', () => {
  it('createRoleSchema trims the name, refuses an empty one and refuses unknown fields (tools are M6-T04)', () => {
    expect(createRoleSchema.parse({ name: '  Packer ' }).name).toBe('Packer');
    expect(createRoleSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'X', tools: ['orders_search'] }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'X', permissions: {} }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'X', copyToolsFromRoleId: 0 }).success).toBe(false);
  });

  it('updateRoleSchema needs at least one field', () => {
    expect(updateRoleSchema.safeParse({}).success).toBe(false);
    expect(updateRoleSchema.safeParse({ area: 'Ads' }).success).toBe(true);
  });

  it('assignSchema reads the type, lowercases an email and refuses extra fields', () => {
    expect(assignSchema.parse({ type: 'person', name: 'Ama B', email: ' AMA@Example.com ' })).toMatchObject({ email: 'ama@example.com' });
    expect(assignSchema.safeParse({ type: 'person', name: 'Ama B' }).success).toBe(false);
    expect(assignSchema.safeParse({ type: 'company', name: 'Logiswift' }).success).toBe(true);
    expect(assignSchema.safeParse({ type: 'ai_agent', name: 'Bot', role: 'super_admin' }).success).toBe(false);
    expect(assignSchema.safeParse({ type: 'ai_agent', name: 'x'.repeat(100) }).success).toBe(true);
    expect(assignSchema.safeParse({ type: 'existing', holderId: -1 }).success).toBe(false);
    expect(assignSchema.safeParse({ type: 'alien', name: 'x' }).success).toBe(false);
  });
});

describe('holderStatus', () => {
  const base = { isActive: false, invitedAt: new Date(), password: '!' };
  it('active wins; an inactive user with an invite and no password is invited; any other inactive user is deactivated', () => {
    expect(holderStatus({ ...base, isActive: true })).toBe('active');
    expect(holderStatus(base)).toBe('invited');
    expect(holderStatus({ ...base, password: '$2b$10$hash' })).toBe('deactivated');
    expect(holderStatus({ ...base, invitedAt: null })).toBe('deactivated');
  });
});

describe('assignPositionRole', () => {
  const dbWith = (found: { id: number } | null) => ({
    role: { findFirst: jest.fn<any>().mockResolvedValue(found) },
    roleAssignment: { create: jest.fn<any>().mockResolvedValue({}) },
  });

  it('writes one assignment for the role mapped from the UserRole, from today, in the tenant', async () => {
    const db = dbWith({ id: 7 });
    const wrote = await runInTenant('tenant-1', () => assignPositionRole(db as any, { id: 42, role: 'sales_rep' }));
    expect(wrote).toBe(true);
    expect(db.role.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { name: ROLE_NAME_BY_USER_ROLE.sales_rep } }));
    const data = (db.roleAssignment.create.mock.calls[0][0] as any).data;
    expect(data).toMatchObject({ tenantId: 'tenant-1', roleId: 7, holderId: 42 });
    expect(data.fromDate.getTime() % 86_400_000).toBe(0);
  });

  it('a tenant without the role writes nothing and does not fail', async () => {
    const db = dbWith(null);
    expect(await runInTenant('tenant-1', () => assignPositionRole(db as any, { id: 1, role: 'admin' }))).toBe(false);
    expect(db.roleAssignment.create).not.toHaveBeenCalled();
  });
});
