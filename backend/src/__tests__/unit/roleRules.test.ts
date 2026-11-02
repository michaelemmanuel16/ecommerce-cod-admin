/** M6-T03: the pure rules of the role API (input schemas, holder status) and the position role of a new user. */
import { describe, it, expect, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { assignSchema, createRoleSchema, updateRoleSchema } from '../../validators/roleSchema';
import { holderStatus } from '../../services/roleService';
import { positionRoleId } from '../../services/systemRoleService';
import { runInTenant } from '../../utils/tenantContext';
import { ROLE_NAME_BY_USER_ROLE } from '../../config/defaultRoles';

describe('roleSchema', () => {
  it('createRoleSchema trims the name, refuses an empty one and refuses unknown fields (tools are M6-T04)', () => {
    expect(createRoleSchema.parse({ name: '  Packer ' }).name).toBe('Packer');
    expect(createRoleSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'X', tools: ['orders_search'] }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'X', permissions: {} }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'X', copyToolsFromRoleId: 0 }).success).toBe(false);
    expect(createRoleSchema.parse({ name: 'X', presetRole: 'sales_rep' }).presetRole).toBe('sales_rep');
    expect(createRoleSchema.safeParse({ name: 'X', presetRole: 'super_admin' }).success).toBe(false);
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
  it('active wins; an inactive user with an invite date is invited; any other inactive user is deactivated', () => {
    expect(holderStatus({ isActive: true, invitedAt: new Date() })).toBe('active');
    expect(holderStatus({ isActive: false, invitedAt: new Date() })).toBe('invited');
    expect(holderStatus({ isActive: false, invitedAt: null })).toBe('deactivated');
  });
});

describe('positionRoleId', () => {
  const dbWith = (found: { id: number } | null) => ({ role: { findFirst: jest.fn<any>().mockResolvedValue(found) } });
  const inTenant = <T>(fn: () => Promise<T>) => runInTenant('tenant-1', fn);

  it('looks the role up by the name mapped from the UserRole', async () => {
    const db = dbWith({ id: 7 });
    expect(await inTenant(() => positionRoleId(db as any, 'sales_rep'))).toBe(7);
    expect(db.role.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { name: ROLE_NAME_BY_USER_ROLE.sales_rep } }));
  });

  it('a tenant without the role gets null, not an error', async () => {
    expect(await inTenant(() => positionRoleId(dbWith(null) as any, 'admin'))).toBeNull();
  });
});
