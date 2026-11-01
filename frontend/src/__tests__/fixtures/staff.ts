import type { StaffList, StaffRow } from '../../services/staff.service';

const person = (over: Partial<StaffRow> & Pick<StaffRow, 'id' | 'name'>): StaffRow => ({
  firstName: over.name.split(' ')[0], lastName: over.name.split(' ')[1] ?? '', email: `${over.name.toLowerCase().replace(' ', '.')}@example.com`,
  phoneNumber: null, kind: 'person', role: 'sales_rep', status: 'active', isActive: true, lastLogin: '2026-11-01T11:30:00Z', invitedAt: null,
  commissionAmount: 8, vehicleType: null, vehicleId: null, location: null, payMethod: 'per_order', positions: [{ id: 1, name: 'Call rep' }], feeRule: null,
  ...over,
});

export const ADWOA = person({ id: 11, name: 'Adwoa Darko', phoneNumber: '0245550111' });
export const KOFI = person({
  id: 12, name: 'Kofi Appiah', role: 'delivery_agent', commissionAmount: 0, payMethod: 'fee_rule', positions: [{ id: 2, name: 'Delivery' }],
  feeRule: { editable: false, url: '/api/delivery-partners/12/fee-rules' }, vehicleType: 'Motorbike', vehicleId: 'GR 1-23', location: 'Kumasi',
});
export const ROBO = person({ id: 13, name: 'Confirm agent', kind: 'ai_agent', email: 'confirm@x.codadmin.internal', payMethod: null, lastLogin: null, commissionAmount: 0 });
export const AKUA = person({ id: 14, name: 'Akua Serwaa', status: 'invited', isActive: false, lastLogin: null, invitedAt: '2026-10-15T09:00:00Z' });
export const YAA = person({ id: 15, name: 'Yaa Pokua', status: 'deactivated', isActive: false });

export const STAFF: StaffList = {
  counts: { active: 3, invited: 1, deactivated: 1, deleted: 0 },
  staff: [ADWOA, KOFI, ROBO, AKUA, YAA],
};

export const ROLES = [
  { roleId: 1, name: 'Call rep', presetRole: 'sales_rep' },
  { roleId: 2, name: 'Delivery', presetRole: 'delivery_agent' },
  { roleId: 3, name: 'Finance clerk', presetRole: 'accountant' },
];
export const COMPANY = { currency: 'GHS', baseCommission: 8, upsellPercent: 10 };
