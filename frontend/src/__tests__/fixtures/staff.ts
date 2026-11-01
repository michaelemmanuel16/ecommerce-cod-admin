import type { RoleCard, RoleHolder } from '../../services/roles.service';
import type { StaffList, StaffRole, StaffRow } from '../../services/staff.service';

const person = (over: Partial<StaffRow> & Pick<StaffRow, 'id' | 'name'>): StaffRow => ({
  firstName: over.name.split(' ')[0], lastName: over.name.split(' ')[1] ?? '', email: `${over.name.toLowerCase().replace(' ', '.')}@example.com`,
  phoneNumber: null, kind: 'person', role: 'sales_rep', status: 'active', isActive: true, lastLogin: '2026-11-01T11:30:00Z', lastActiveAt: '2026-11-01T11:30:00Z', invitedAt: null,
  commissionAmount: 8, vehicleType: null, vehicleId: null, location: null, payMethod: 'per_order', positions: [{ id: 1, name: 'Call rep' }], feeRule: null,
  ...over,
});

export const ADWOA = person({ id: 11, name: 'Adwoa Darko', phoneNumber: '0245550111' });
export const KOFI = person({
  id: 12, name: 'Kofi Appiah', role: 'delivery_agent', commissionAmount: 0, payMethod: 'fee_rule', positions: [{ id: 2, name: 'Delivery' }],
  feeRule: { editable: false, url: '/api/delivery-partners/12/fee-rules', delivered: { basis: 'flat', amount: 25 } }, vehicleType: 'Motorbike', vehicleId: 'GR 1-23', location: 'Kumasi',
});
export const ROBO = person({ id: 13, name: 'Confirm agent', kind: 'ai_agent', email: 'confirm@x.codadmin.internal', payMethod: null, lastLogin: null, lastActiveAt: '2026-11-01T11:00:00Z', commissionAmount: 0 });
export const AKUA = person({ id: 14, name: 'Akua Serwaa', status: 'invited', isActive: false, lastLogin: null, lastActiveAt: null, invitedAt: '2026-10-15T09:00:00Z' });
export const YAA = person({ id: 15, name: 'Yaa Pokua', status: 'deactivated', isActive: false });

export const STAFF: StaffList = {
  counts: { active: 3, invited: 1, deactivated: 1, deleted: 0 },
  staff: [ADWOA, KOFI, ROBO, AKUA, YAA],
};

export const ROLES: StaffRole[] = [
  { roleId: 1, name: 'Call rep', presetRole: 'sales_rep' },
  { roleId: 2, name: 'Delivery', presetRole: 'delivery_agent' },
  { roleId: 3, name: 'Finance clerk', presetRole: 'accountant' },
];
export const COMPANY = { currency: 'GHS', baseCommission: 8, upsellPercent: 10 };

/** A role card of GET /api/roles/overview, for a role of ROLES. */
export const roleCard = (role: StaffRole, over: Partial<RoleCard> = {}): RoleCard => ({
  id: role.roleId, name: role.name, area: null, contract: null, presetRole: role.presetRole, isSystem: false,
  tools: ['view_orders', 'view_customers'], toolCount: 2, toolTotal: 16, holderCount: 0, custom: false, holders: [], target: null, ...over,
});

export const holder = (over: Partial<RoleHolder> & Pick<RoleHolder, 'id' | 'name'>): RoleHolder => ({
  assignmentId: over.id * 10, since: '2026-10-01T00:00:00.000Z', email: `${over.id}@example.com`, kind: 'person', typeLabel: 'Human', status: 'active', ...over,
});
