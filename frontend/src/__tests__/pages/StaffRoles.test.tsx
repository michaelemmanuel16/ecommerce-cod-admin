import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Staff } from '../../pages/Staff';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useAuthStore } from '../../stores/authStore';
import type { RoleAssignment } from '../../services/roles.service';
import type { Attainment, Tree } from '../../services/targets.service';
import { COMPANY, ROLES, STAFF, holder, roleCard } from '../fixtures/staff';

const svc = vi.hoisted(() => ({ list: vi.fn(), workload: vi.fn(), invite: vi.fn(), companyRepPay: vi.fn() }));
vi.mock('../../services/staff.service', async (orig) => {
  const { companyRepPay, ...staffService } = svc;
  return { ...(await orig<typeof import('../../services/staff.service')>()), staffService, companyRepPay };
});
const rolesSvc = vi.hoisted(() => ({ overview: vi.fn(), assignments: vi.fn(), create: vi.fn(), remove: vi.fn(), assign: vi.fn(), unassign: vi.fn() }));
vi.mock('../../services/roles.service', async (orig) => ({ ...(await orig<typeof import('../../services/roles.service')>()), rolesService: rolesSvc }));
const targetsSvc = vi.hoisted(() => ({ tree: vi.fn(), attainment: vi.fn(), rewardSettings: vi.fn() }));
vi.mock('../../services/targets.service', () => ({ targetsService: targetsSvc }));
// The Pay card has its own tests (PayCard.test.tsx); these tests are about the role cards
vi.mock('../../pages/staff/PayCard', () => ({ PayCard: () => null }));

let permitted = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => permitted }) }));
const copy = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useCopyToClipboard', () => ({ useCopyToClipboard: () => ({ copied: false, copy }) }));

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}{l.search}</output>; }
const renderPage = () => render(<MemoryRouter initialEntries={['/staff']}><ToastProvider><Staff /><Where /></ToastProvider></MemoryRouter>);

const [CALL, DELIVERY, FINANCE] = ROLES;
const ADWOA = holder({ id: 11, name: 'Adwoa Darko' });
const ROBO = holder({ id: 13, name: 'Confirm agent', kind: 'ai_agent', typeLabel: 'AI agent' });
const LOGISWIFT = holder({ id: 16, name: 'Logiswift', kind: 'company', typeLabel: 'Company' });
const OWNER_ROLE = roleCard({ roleId: 9, name: 'Owner', presetRole: 'super_admin' }, { toolCount: 16, tools: ['view_orders'] });

const CARDS = () => [
  roleCard(CALL, { holders: [ADWOA, ROBO], holderCount: 2, target: { metric: 'confirmed_delivered', unit: 'count', value: 723, periodStart: '2026-11-01', periodEnd: '2026-11-30' } }),
  roleCard(DELIVERY, { holders: [LOGISWIFT], holderCount: 1, toolCount: 4 }),
  roleCard(FINANCE),
];
const cardOf = (name: string) => screen.getByRole('button', { name: `${name} role` });
const detail = () => document.querySelector('.detail') as HTMLElement;

const TREE = {
  year: 2026, metric: 'revenue', currency: 'GHS', marginTarget: 35, northStar: null, quarters: [], months: [],
  roles: [{
    roleId: CALL.roleId, roleName: CALL.name, pool: null,
    target: { id: 1, updatedAt: '', scope: 'role', metric: 'confirmed_delivered', unit: 'count', value: 723, periodStart: '2026-11-01', periodEnd: '2026-11-30', parentId: null, closed: false },
    holders: [{ userId: 11, name: 'Adwoa Darko', kind: 'person', typeLabel: 'Human', target: { id: 2, metric: 'confirmed_delivered', unit: 'count', value: 723 }, label: null }],
  }],
} as unknown as Tree;
const ATTAINMENT = {
  period: '2026-11', closed: false, currency: 'GHS',
  results: [{ userId: 11, name: 'Adwoa Darko', kind: 'person', roleId: CALL.roleId, roleName: CALL.name, payout: true, metric: 'confirmed_delivered', unit: 'count', target: 723, actual: 376, percent: 52, tier: 'none', reward: null, earned: false, status: { key: 'behind', label: 'Behind' }, distance: null, warning: null, message: '' }],
} as unknown as Attainment;

beforeEach(() => {
  clearBlockCache();
  permitted = true;
  useAuthStore.setState({ user: { id: 1, role: 'super_admin' } as never });
  [svc, rolesSvc, targetsSvc].forEach((o) => Object.values(o).forEach((f) => f.mockReset()));
  copy.mockReset();
  svc.list.mockResolvedValue(STAFF);
  svc.workload.mockResolvedValue([]);
  svc.companyRepPay.mockResolvedValue(COMPANY);
  rolesSvc.overview.mockResolvedValue(CARDS());
  rolesSvc.assignments.mockResolvedValue([]);
  targetsSvc.tree.mockResolvedValue(null);
  targetsSvc.attainment.mockResolvedValue(null);
  targetsSvc.rewardSettings.mockResolvedValue(null);
});

describe('Staff page: role cards', () => {
  it('shows a card per role with holders, type tags, the target and "n of 16 tools allowed"', async () => {
    renderPage();
    const call = within(await screen.findByRole('button', { name: 'Call rep role' }));
    expect(call.getByText('2 holders')).toBeInTheDocument();
    expect(call.getByText('Adwoa Darko')).toBeInTheDocument();
    expect(call.getByText('Human')).toBeInTheDocument();
    expect(call.getByText('AI agent')).toBeInTheDocument();
    expect(call.getByText('723 confirmed and delivered')).toBeInTheDocument();
    expect(call.getByText('2 of 16 tools allowed')).toBeInTheDocument();
    const delivery = within(cardOf('Delivery'));
    expect(delivery.getByText('Logiswift')).toBeInTheDocument();
    expect(delivery.getByText('Company')).toBeInTheDocument();
    expect(delivery.getByText('4 of 16 tools allowed')).toBeInTheDocument();
    expect(delivery.getByText('No target set')).toBeInTheDocument();
  });

  it('a role with no holder is Vacant', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Finance clerk role' });
    const finance = within(cardOf('Finance clerk'));
    expect(finance.getByText('Vacant')).toBeInTheDocument();
    expect(finance.getByText('No holder')).toBeInTheDocument();
  });

  it('progress and status come from this month\'s targets and attainment', async () => {
    targetsSvc.tree.mockResolvedValue(TREE);
    targetsSvc.attainment.mockResolvedValue(ATTAINMENT);
    renderPage();
    const call = within(await screen.findByRole('button', { name: 'Call rep role' }));
    expect(await call.findByRole('progressbar', { name: 'Call rep progress' })).toHaveAttribute('aria-valuenow', '52');
    expect(call.getByText('376 of 723 · 52% of role target')).toBeInTheDocument();
    expect(call.getByText('Behind')).toBeInTheDocument();
  });

  it('the cards show without progress when targets cannot be read', async () => {
    targetsSvc.tree.mockRejectedValue(new Error('403'));
    targetsSvc.attainment.mockRejectedValue(new Error('403'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Call rep role' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('a failed overview shows an error with Retry, not a blank page', async () => {
    rolesSvc.overview.mockRejectedValueOnce(new Error('500'));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Retry|Try again/ }));
    expect(await screen.findByRole('button', { name: 'Call rep role' })).toBeInTheDocument();
  });

  it('selecting a card opens its detail', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    expect(within(detail()).getByRole('heading', { name: 'Call rep' })).toBeInTheDocument();
    await userEvent.click(cardOf('Delivery'));
    expect(within(detail()).getByRole('heading', { name: 'Delivery' })).toBeInTheDocument();
    expect(cardOf('Delivery')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Staff page: role detail and history', () => {
  it('lists the holders now; the holders who left show in History only', async () => {
    const left: RoleAssignment[] = [
      { assignmentId: 1, from: '2026-09-01T00:00:00Z', to: null, current: true, id: 11, name: 'Adwoa Darko', kind: 'person', typeLabel: 'Human' },
      { assignmentId: 2, from: '2026-08-01T00:00:00Z', to: '2026-10-02T00:00:00Z', current: false, id: 20, name: 'Yaa Pokua', kind: 'person', typeLabel: 'Human' },
    ];
    rolesSvc.assignments.mockResolvedValue(left);
    renderPage();
    const past = within(await screen.findByRole('list', { name: 'Holders who left' }));
    expect(past.getByText('Yaa Pokua')).toBeInTheDocument();
    expect(past.queryByText('Adwoa Darko')).toBeNull();
    // Not on the card, not in the holders list: once in the detail, in History
    expect(within(cardOf('Call rep')).queryByText('Yaa Pokua')).toBeNull();
    expect(within(detail()).getAllByText('Yaa Pokua')).toHaveLength(1);
    expect(rolesSvc.assignments).toHaveBeenCalledWith(CALL.roleId);
  });

  it('says so when nobody has left', async () => {
    renderPage();
    expect(await screen.findByText('Nobody has left this role.')).toBeInTheDocument();
  });

  it('shows the tools count and the 16 switches (the switches are tested in StaffRoleTools)', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    expect(within(detail()).getByText('2 of 16 on')).toBeInTheDocument();
    expect(within(detail()).getAllByRole('switch', { name: /^(View|Export|Update|Assign|Call|Message|Edit|Adjust|Record|Manage) / })).toHaveLength(16);
  });

  it('Remove asks first, then ends the assignment and asks again', async () => {
    rolesSvc.unassign.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Adwoa Darko from Call rep' }));
    expect(rolesSvc.unassign).not.toHaveBeenCalled();
    const calls = rolesSvc.overview.mock.calls.length;
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(rolesSvc.unassign).toHaveBeenCalledWith(CALL.roleId, ADWOA.assignmentId));
    expect(await screen.findByText('Adwoa Darko left Call rep')).toBeInTheDocument();
    await waitFor(() => expect(rolesSvc.overview.mock.calls.length).toBeGreaterThan(calls));
  });
});

describe('Staff page: assign menu', () => {
  const openMenu = async () => { await userEvent.click(await screen.findByRole('button', { name: /^Assign/ })); return screen.getByRole('menu', { name: 'Assign Call rep' }); };

  it('has the three choices', async () => {
    renderPage();
    const menu = within(await openMenu());
    expect(menu.getByRole('menuitem', { name: /Invite a person/ })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: /Connect an AI agent/ })).toBeInTheDocument();
    expect(menu.getByRole('menuitem', { name: /Add a company/ })).toBeInTheDocument();
  });

  it('Invite a person opens the invite modal with the role chosen', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delivery role' }));
    await userEvent.click(screen.getByRole('button', { name: /^Assign/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Invite a person/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a person' });
    expect(within(dialog).getByLabelText('Role')).toHaveValue(String(DELIVERY.roleId));
    expect(screen.getByTestId('where')).toHaveTextContent('/staff?invite=1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // The next plain invite starts on the usual role again
    await userEvent.click(screen.getByRole('button', { name: /Invite a person/ }));
    expect(await within(await screen.findByRole('dialog', { name: 'Invite a person' })).findByLabelText('Role')).toHaveValue(String(CALL.roleId));
  });

  it('Connect an AI agent makes the agent and shows its key once, with Copy', async () => {
    rolesSvc.assign.mockResolvedValue({ holder: { id: 30, name: 'Night agent', kind: 'ai_agent' }, apiKey: { key: 'cod_mcp_SECRET123', keyPrefix: 'cod_mcp_SEC', label: 'Night agent', toolCount: 2 } });
    renderPage();
    await openMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: /Connect an AI agent/ }));
    await userEvent.type(screen.getByLabelText('Agent name'), '  Night agent ');
    await userEvent.click(screen.getByRole('button', { name: 'Create MCP key' }));
    await waitFor(() => expect(rolesSvc.assign).toHaveBeenCalledWith(CALL.roleId, { type: 'ai_agent', name: 'Night agent' }));
    const key = await screen.findByLabelText('MCP key');
    expect(key).toHaveValue('cod_mcp_SECRET123');
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy key' }));
    expect(copy).toHaveBeenCalledWith('cod_mcp_SECRET123');
    // Done closes the box: the key is gone and nothing on the page asks the API for it again
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('MCP key')).toBeNull();
    expect(screen.queryByDisplayValue('cod_mcp_SECRET123')).toBeNull();
  });

  it('an AI agent cannot be given the Owner role: the API\'s message shows and no key does', async () => {
    rolesSvc.overview.mockResolvedValue([OWNER_ROLE, ...CARDS()]);
    rolesSvc.assign.mockRejectedValue({ response: { data: { message: 'An AI agent cannot hold the Owner role' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Assign/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Connect an AI agent/ }));
    await userEvent.type(screen.getByLabelText('Agent name'), 'Robo');
    await userEvent.click(screen.getByRole('button', { name: 'Create MCP key' }));
    expect(await screen.findByText('An AI agent cannot hold the Owner role')).toBeInTheDocument();
    expect(screen.queryByLabelText('MCP key')).toBeNull();
  });

  it('Add a company needs a name, then adds it and closes the box', async () => {
    rolesSvc.assign.mockResolvedValue({ holder: { id: 31, name: 'Kasapa Express', kind: 'company' } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /^Assign/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Add a company/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));
    expect(await screen.findByText('Enter a company name')).toBeInTheDocument();
    expect(rolesSvc.assign).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Company name'), 'Kasapa Express');
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));
    await waitFor(() => expect(rolesSvc.assign).toHaveBeenCalledWith(CALL.roleId, { type: 'company', name: 'Kasapa Express' }));
    expect(await screen.findByText('Kasapa Express added to Call rep')).toBeInTheDocument();
    expect(screen.queryByLabelText('Company name')).toBeNull();
  });

  it('a person who may not add people has no Assign menu and no Remove', async () => {
    permitted = false;
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    expect(screen.queryByRole('button', { name: /^Assign/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
  });
});

describe('Staff page: new role and delete', () => {
  it('New role takes a name and a base preset, then the role shows as a card', async () => {
    const made = roleCard({ roleId: 40, name: 'Customer support', presetRole: null }, { tools: [], toolCount: 0 });
    rolesSvc.create.mockImplementation(async () => { rolesSvc.overview.mockResolvedValue([...CARDS(), made]); return made; });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /New role/ }));
    const dialog = within(screen.getByRole('dialog', { name: 'New role' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Create role' }));
    expect(await dialog.findByText('Enter a name for the role')).toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText('Role name'), 'Customer support');
    await userEvent.selectOptions(dialog.getByLabelText('Start with the tools of'), 'Call rep');
    await userEvent.click(dialog.getByRole('button', { name: 'Create role' }));
    await waitFor(() => expect(rolesSvc.create).toHaveBeenCalledWith({ name: 'Customer support', copyToolsFromRoleId: CALL.roleId }));
    expect(await screen.findByRole('button', { name: 'Customer support role' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog', { name: 'New role' })).toBeNull();
  });

  it('a duplicate name shows the API\'s message in the modal', async () => {
    rolesSvc.create.mockRejectedValue({ response: { data: { message: 'A role with this name already exists' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /New role/ }));
    await userEvent.type(screen.getByLabelText('Role name'), 'Delivery');
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }));
    expect(await screen.findByText('A role with this name already exists')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New role' })).toBeInTheDocument();
  });

  it('only the Owner sees New role and Delete role', async () => {
    useAuthStore.setState({ user: { id: 2, role: 'admin' } as never });
    renderPage();
    await screen.findByRole('button', { name: 'Call rep role' });
    expect(screen.queryByRole('button', { name: /New role/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete role' })).toBeNull();
  });

  it('deleting a role with holders shows "Move N holders first"', async () => {
    rolesSvc.remove.mockRejectedValue({ response: { data: { message: 'Move 2 holders first' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete role' }));
    expect(rolesSvc.remove).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Move 2 holders first')).toBeInTheDocument();
    expect(rolesSvc.remove).toHaveBeenCalledWith(CALL.roleId);
    expect(screen.getByRole('button', { name: 'Call rep role' })).toBeInTheDocument();
  });

  it('deleting an empty role removes it and asks again; the Owner role has no Delete', async () => {
    rolesSvc.remove.mockResolvedValue(undefined);
    rolesSvc.overview.mockResolvedValue([OWNER_ROLE, ...CARDS()]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Owner role' }));
    expect(screen.queryByRole('button', { name: 'Delete role' })).toBeNull();
    await userEvent.click(cardOf('Finance clerk'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete role' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(rolesSvc.remove).toHaveBeenCalledWith(FINANCE.roleId));
    expect(await screen.findByText('Finance clerk was deleted')).toBeInTheDocument();
  });
});
