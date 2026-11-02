import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Staff } from '../../pages/Staff';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useAuthStore } from '../../stores/authStore';
import type { RolePermissions } from '../../services/roles.service';
import type { RewardSettings, Tree } from '../../services/targets.service';
import { roleProgress } from '../../pages/staff/roleModel';
import { COMPANY, ROLES, STAFF, roleCard } from '../fixtures/staff';

const svc = vi.hoisted(() => ({ list: vi.fn(), workload: vi.fn(), companyRepPay: vi.fn() }));
vi.mock('../../services/staff.service', async (orig) => {
  const { companyRepPay, ...staffService } = svc;
  return { ...(await orig<typeof import('../../services/staff.service')>()), staffService, companyRepPay };
});
const rolesSvc = vi.hoisted(() => ({ overview: vi.fn(), assignments: vi.fn(), setTools: vi.fn(), permissions: vi.fn(), savePermissions: vi.fn() }));
vi.mock('../../services/roles.service', async (orig) => ({ ...(await orig<typeof import('../../services/roles.service')>()), rolesService: rolesSvc }));
const targetsSvc = vi.hoisted(() => ({ tree: vi.fn(), attainment: vi.fn(), rewardSettings: vi.fn() }));
vi.mock('../../services/targets.service', () => ({ targetsService: targetsSvc }));
vi.mock('../../pages/staff/PayCard', () => ({ PayCard: () => null }));
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => true }) }));

const renderPage = () => render(<MemoryRouter initialEntries={['/staff']}><ToastProvider><Staff /></ToastProvider></MemoryRouter>);
const [CALL, DELIVERY] = ROLES;
const detail = () => document.querySelector('.detail') as HTMLElement;
const sw = (name: string) => within(detail()).getByRole('switch', { name }) as HTMLInputElement;
const refusal = (message: string) => ({ response: { data: { message } } });

const CATALOG = { orders: ['view', 'update', 'assign'], customers: ['view', 'update'], analytics: ['view', 'export'] };
const GRID = { orders: ['view'], customers: ['view'], analytics: [] };
const PERMISSIONS: RolePermissions = { permissions: GRID, catalog: CATALOG, custom: false, saved: true };
const REWARDS: RewardSettings = {
  currency: 'GHS', noPayout: [], notice: '', badgesDisplay: false, repPay: { baseCommission: 8, upsellPercent: 10 },
  tiers: [
    { roleId: CALL.roleId, roleName: 'Call rep', tier100: { amount: 600, dayOff: false, payout: true }, tier120: { amount: 900, dayOff: true, payout: true } },
    { roleId: DELIVERY.roleId, roleName: 'Delivery', tier100: { amount: 0, dayOff: true, payout: true }, tier120: null },
  ],
};

beforeEach(() => {
  clearBlockCache();
  useAuthStore.setState({ user: { id: 1, role: 'super_admin' } as never, menu: null, homeRoute: null });
  [svc, rolesSvc, targetsSvc].forEach((o) => Object.values(o).forEach((f) => f.mockReset()));
  svc.list.mockResolvedValue(STAFF);
  svc.workload.mockResolvedValue([]);
  svc.companyRepPay.mockResolvedValue(COMPANY);
  rolesSvc.overview.mockResolvedValue([
    roleCard(CALL, { tools: ['view_orders', 'view_customers', 'update_order_status'], toolCount: 3 }),
    roleCard(DELIVERY, { tools: ['view_orders'], toolCount: 1 }),
    roleCard({ roleId: 9, name: 'Owner', presetRole: 'super_admin' }, { tools: ['view_orders', 'manage_team'], toolCount: 2 }),
  ]);
  rolesSvc.assignments.mockResolvedValue([]);
  rolesSvc.permissions.mockResolvedValue(PERMISSIONS);
  targetsSvc.tree.mockResolvedValue(null);
  targetsSvc.attainment.mockResolvedValue(null);
  targetsSvc.rewardSettings.mockResolvedValue(REWARDS);
});

describe('Role detail: allowed tools', () => {
  it('shows the 16 switches, 7 read and 9 write, on as the role has them', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    const d = within(detail());
    expect(d.getByText('3 of 16 on')).toBeInTheDocument();
    expect(d.getAllByRole('switch').filter((s) => s.closest('.tgroup'))).toHaveLength(16);
    const groups = detail().querySelectorAll('.tgroup');
    expect(groups[0].querySelectorAll('input[role="switch"]')).toHaveLength(7);
    expect(groups[1].querySelectorAll('input[role="switch"]')).toHaveLength(9);
    expect(sw('View orders').checked).toBe(true);
    expect(sw('Update order status').checked).toBe(true);
    expect(sw('Export data').checked).toBe(false);
  });

  it('a flip saves the new list in table order, updates the count and asks for the roles again', async () => {
    const after = roleCard(CALL, { tools: ['view_orders', 'view_customers', 'export_data', 'update_order_status'], toolCount: 4 });
    rolesSvc.setTools.mockResolvedValue(after);
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    const asked = rolesSvc.overview.mock.calls.length;
    await userEvent.click(sw('Export data'));
    await waitFor(() => expect(rolesSvc.setTools).toHaveBeenCalledWith(CALL.roleId, ['view_orders', 'view_customers', 'export_data', 'update_order_status']));
    expect(await within(detail()).findByText('4 of 16 on')).toBeInTheDocument();
    expect(sw('Export data').checked).toBe(true);
    await waitFor(() => expect(rolesSvc.overview.mock.calls.length).toBeGreaterThan(asked));
  });

  it('switching a read tool off while its write tool is on shows the dependency error and leaves the switch on', async () => {
    rolesSvc.setTools.mockRejectedValue(refusal('Needs View orders'));
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    await userEvent.click(sw('View orders'));
    expect(await within(detail()).findByRole('alert')).toHaveTextContent('Needs View orders');
    expect(rolesSvc.setTools).toHaveBeenCalledWith(CALL.roleId, ['view_customers', 'update_order_status']);
    expect(sw('View orders').checked).toBe(true);
    expect(within(detail()).getByText('3 of 16 on')).toBeInTheDocument();
  });

  it('the Owner switches are locked', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Owner role' }));
    const switches = within(detail()).getAllByRole('switch').filter((s) => s.closest('.tgroup')) as HTMLInputElement[];
    expect(switches).toHaveLength(16);
    expect(switches.every((s) => s.disabled)).toBe(true);
  });

  it('a person who is not the Owner reads the switches and cannot flip them', async () => {
    useAuthStore.setState({ user: { id: 2, role: 'admin' } as never });
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    expect(sw('View orders').disabled).toBe(true);
    expect(sw('View orders').checked).toBe(true);
  });
});

describe('Role detail: Advanced permissions', () => {
  const open = async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Advanced permissions/ }));
    return within(await screen.findByRole('group', { name: 'Permission cells' }));
  };

  it('is closed until opened, then loads the grid of the role', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    expect(rolesSvc.permissions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Advanced permissions/ }));
    const cells = within(await screen.findByRole('group', { name: 'Permission cells' }));
    expect(rolesSvc.permissions).toHaveBeenCalledWith(CALL.roleId);
    expect(cells.getByRole('switch', { name: 'orders view' })).toBeChecked();
    expect(cells.getByRole('switch', { name: 'orders update' })).not.toBeChecked();
    expect(cells.getByRole('switch', { name: 'analytics export' })).not.toBeChecked();
  });

  it('changing a cell marks the role Custom; Save sends the whole grid and asks for the roles again', async () => {
    rolesSvc.savePermissions.mockResolvedValue({});
    const cells = await open();
    expect(screen.queryByText('Custom')).toBeNull();
    await userEvent.click(cells.getByRole('switch', { name: 'orders update' }));
    expect(screen.getByText('Custom')).toBeInTheDocument();
    const asked = rolesSvc.overview.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(rolesSvc.savePermissions).toHaveBeenCalledWith(CALL.roleId, { orders: ['view', 'update'], customers: ['view'], analytics: [] }));
    await waitFor(() => expect(rolesSvc.overview.mock.calls.length).toBeGreaterThan(asked));
  });

  it('Save is off until something changed; Reset to preset puts the saved grid back', async () => {
    const cells = await open();
    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeDisabled();
    await userEvent.click(cells.getByRole('switch', { name: 'customers update' }));
    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to preset' }));
    expect(cells.getByRole('switch', { name: 'customers update' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Save permissions' })).toBeDisabled();
  });

  it('Full access ticks every cell of the catalog and Read only keeps the view cells', async () => {
    const cells = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Full access' }));
    expect(cells.getAllByRole('switch').every((s) => (s as HTMLInputElement).checked)).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Read only' }));
    expect(cells.getByRole('switch', { name: 'orders view' })).toBeChecked();
    expect(cells.getByRole('switch', { name: 'orders assign' })).not.toBeChecked();
    expect(cells.getByRole('switch', { name: 'analytics view' })).toBeChecked();
  });

  it('search narrows the resources', async () => {
    const cells = await open();
    await userEvent.type(screen.getByLabelText('Search permissions'), 'cust');
    expect(cells.getByRole('switch', { name: 'customers view' })).toBeInTheDocument();
    expect(cells.queryByRole('switch', { name: 'orders view' })).toBeNull();
  });

  it('a refusal of the API shows as a toast and keeps the edit', async () => {
    rolesSvc.savePermissions.mockRejectedValue(refusal('This is the last role that can manage users'));
    const cells = await open();
    await userEvent.click(cells.getByRole('switch', { name: 'orders assign' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    expect(await screen.findByText('This is the last role that can manage users')).toBeInTheDocument();
    expect(cells.getByRole('switch', { name: 'orders assign' })).toBeChecked();
  });

  it('the Owner role is read only', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Owner role' }));
    await userEvent.click(screen.getByRole('button', { name: /Advanced permissions/ }));
    const cells = within(await screen.findByRole('group', { name: 'Permission cells' }));
    expect(cells.getByRole('switch', { name: 'orders view' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull();
  });
});

describe('Role detail: reward rule and phone view', () => {
  it('shows the cash tiers of Settings, Rewards, read only, and Edit rule opens the Rewards tab', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    const rule = within(await within(detail()).findByText('Reward rule').then((h) => h.closest('.dsec') as HTMLElement));
    expect(await rule.findByText('100%')).toBeInTheDocument();
    expect(rule.getByText('120%')).toBeInTheDocument();
    expect(rule.getByText('GH₵600')).toBeInTheDocument();
    expect(rule.getByText('GH₵900')).toBeInTheDocument();
    expect(rule.queryByRole('textbox')).toBeNull();
    expect(rule.getByRole('link', { name: 'Edit rule' })).toHaveAttribute('href', '/settings?tab=rewards');
  });

  it('a role with a day-off tier and no cash shows no cash reward', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delivery role' }));
    expect(await within(detail()).findByText('No cash reward for this role.')).toBeInTheDocument();
  });

  it('a reader without Settings access is told the rule needs it', async () => {
    targetsSvc.rewardSettings.mockRejectedValue(new Error('403'));
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    expect(await within(detail()).findByText('The reward rule needs Settings access.')).toBeInTheDocument();
  });

  it('the delivery phone view link shows where the phone screens open, and there is no call-rep link', async () => {
    useAuthStore.setState({ user: { id: 3, role: 'delivery_agent' } as never, menu: ['inbox', 'orders', 'settings'], homeRoute: '/' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delivery role' }));
    expect(within(detail()).getByRole('link', { name: /Open delivery agent phone view/ })).toHaveAttribute('href', '/m');
    await userEvent.click(screen.getByRole('button', { name: 'Call rep role' }));
    expect(within(detail()).queryByRole('link', { name: /phone view|call-rep/i })).toBeNull();
  });

  it('the owner, who cannot open the phone screens, gets no link to them', async () => {
    useAuthStore.setState({ menu: ['dashboard', 'orders', 'settings'], homeRoute: '/' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delivery role' }));
    expect(within(detail()).queryByRole('link', { name: /phone view/i })).toBeNull();
  });
});

describe('Role progress (the API works the numbers out; the model words them)', () => {
  const tree = (roleAttainment: unknown) => ({ roles: [{ roleId: 2, roleName: 'Delivery', roleAttainment }] }) as unknown as Tree;

  it('words a rate target: the average rate against the target, the bar capped at 100, the status tag from the key', () => {
    const p = roleProgress(tree({ done: 48, target: 80, percent: 60, rate: true, status: { key: 'behind', label: 'Behind' } })).get(2)!;
    expect(p.text).toBe('48% of 80% · 60% of role target');
    expect(p.percent).toBe(60);
    expect(p.tone).toBe('gold');
    expect(p.status).toEqual({ label: 'Behind', tone: 'warn' });
    expect(roleProgress(tree({ done: 130, target: 100, percent: 130, rate: false, status: null })).get(2)).toMatchObject({ percent: 100, text: '130 of 100 · 130% of role target', status: null });
  });

  it('a role with no attainment, or no tree, has no progress', () => {
    expect(roleProgress(tree(null)).size).toBe(0);
    expect(roleProgress(null).size).toBe(0);
  });
});
