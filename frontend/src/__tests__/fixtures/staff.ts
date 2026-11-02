import type { RoleCard, RoleHolder, RoleTool } from '../../services/roles.service';
import type { PayPolicy, StaffList, StaffRole, StaffRow } from '../../services/staff.service';

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

/** What the API sends in `payPolicy` (backend payPolicyFor). */
export const PAYS: PayPolicy = { methods: ['per_order', 'fee_rule', 'none'], defaultMethod: 'none', amountEditable: true };
export const FEE_PAYS: PayPolicy = { methods: ['fee_rule', 'none'], defaultMethod: 'fee_rule', amountEditable: false };

export const ROLES: StaffRole[] = [
  { roleId: 1, name: 'Call rep', presetRole: 'sales_rep', payPolicy: PAYS },
  { roleId: 2, name: 'Delivery', presetRole: 'delivery_agent', payPolicy: FEE_PAYS },
  { roleId: 3, name: 'Finance clerk', presetRole: 'accountant', payPolicy: PAYS },
];

/** The 16 switches of GET /api/roles/overview (backend ROLE_TOOL_CATALOG), 7 read and 9 write. */
export const TOOL_CATALOG: RoleTool[] = [
  ['view_orders', 'View orders', 'read'], ['view_customers', 'View customers', 'read'], ['view_stock', 'View stock', 'read'],
  ['view_payouts', 'View payouts', 'read'], ['view_reports', 'View reports', 'read'], ['view_targets', 'View targets', 'read'],
  ['export_data', 'Export data', 'read'], ['update_order_status', 'Update order status', 'write'], ['assign_orders', 'Assign orders', 'write'],
  ['call_customers', 'Call customers', 'write'], ['message_customers', 'Message customers', 'write'], ['edit_products', 'Edit products', 'write'],
  ['adjust_stock', 'Adjust stock', 'write'], ['record_payout', 'Record payout', 'write'], ['edit_targets', 'Edit targets', 'write'],
  ['manage_team', 'Manage team', 'write'],
].map(([key, label, kind]) => ({ key, label, kind }) as RoleTool);
export const COMPANY = { currency: 'GHS', baseCommission: 8, upsellPercent: 10 };

/** A role card of GET /api/roles/overview, for a role of ROLES. */
export const roleCard = (role: StaffRole, over: Partial<RoleCard> = {}): RoleCard => ({
  id: role.roleId, name: role.name, area: null, contract: null, presetRole: role.presetRole, isSystem: false,
  tools: ['view_orders', 'view_customers'], toolCatalog: TOOL_CATALOG, payPolicy: role.payPolicy, toolCount: 2, toolTotal: 16, holderCount: 0, custom: false, holders: [], target: null, ...over,
});

export const holder = (over: Partial<RoleHolder> & Pick<RoleHolder, 'id' | 'name'>): RoleHolder => ({
  assignmentId: over.id * 10, since: '2026-10-01T00:00:00.000Z', email: `${over.id}@example.com`, kind: 'person', typeLabel: 'Human', status: 'active', ...over,
});
