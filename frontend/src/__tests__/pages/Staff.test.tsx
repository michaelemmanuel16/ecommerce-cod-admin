import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Staff } from '../../pages/Staff';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useAuthStore } from '../../stores/authStore';
import { NAV_GROUPS } from '../../components/shell/navModel';
import { ADWOA, AKUA, COMPANY, KOFI, ROBO, ROLES, STAFF, YAA } from '../fixtures/staff';

const svc = vi.hoisted(() => ({
  list: vi.fn(), workload: vi.fn(), roles: vi.fn(), invite: vi.fn(), resend: vi.fn(), revoke: vi.fn(), update: vi.fn(),
  resetPassword: vi.fn(), deactivate: vi.fn(), reactivate: vi.fn(), remove: vi.fn(), removePermanently: vi.fn(), companyRepPay: vi.fn(),
}));
vi.mock('../../services/staff.service', async (orig) => {
  const { companyRepPay, ...staffService } = svc;
  return { ...(await orig<typeof import('../../services/staff.service')>()), staffService, companyRepPay };
});
const reassign = vi.hoisted(() => vi.fn());
vi.mock('../../pages/staff/reassign', () => ({ reassignOpenOrders: reassign }));

let permitted = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => permitted }) }));

const navigated = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigated }));

const copy = vi.hoisted(() => vi.fn());
vi.mock('../../hooks/useCopyToClipboard', () => ({ useCopyToClipboard: () => ({ copied: false, copy }) }));

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}{l.search}</output>; }
const renderPage = (url = '/staff') => render(<MemoryRouter initialEntries={[url]}><ToastProvider><Staff /><Where /></ToastProvider></MemoryRouter>);
const where = () => screen.getByTestId('where').textContent;
const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(name) });
const menuOf = async (name: string) => { await userEvent.click(screen.getByRole('button', { name: `Actions for ${name}` })); return screen.getByRole('menu'); };

beforeEach(() => {
  clearBlockCache();
  permitted = true;
  useAuthStore.setState({ user: { id: 1, role: 'super_admin' } as never });
  Object.values(svc).forEach((f) => f.mockReset());
  navigated.mockReset();
  reassign.mockReset();
  copy.mockReset();
  svc.list.mockResolvedValue(STAFF);
  svc.roles.mockResolvedValue(ROLES);
  svc.companyRepPay.mockResolvedValue(COMPANY);
  svc.workload.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe('Staff page: tabs, counts and the table', () => {
  it('reads the tab counts and the header text from the API (no typed numbers)', async () => {
    renderPage();
    expect(await screen.findByText('3 on the team · 1 invited · 1 deactivated')).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Team status' });
    expect(within(tabs).getByRole('tab', { name: /^All/ })).toHaveTextContent('5');
    expect(within(tabs).getByRole('tab', { name: /^Active/ })).toHaveTextContent('3');
    expect(within(tabs).getByRole('tab', { name: /^Invited/ })).toHaveTextContent('1');
    expect(within(tabs).getByRole('tab', { name: /^Deactivated/ })).toHaveTextContent('1');
    expect(within(tabs).queryByRole('tab', { name: /^Deleted/ })).toBeNull();
    expect(svc.list).toHaveBeenCalledWith({});
  });

  it('a tab asks the API for that status and keeps it in the URL', async () => {
    renderPage();
    await screen.findByText(/on the team/);
    svc.list.mockResolvedValue({ counts: STAFF.counts, staff: [AKUA] });
    await userEvent.click(screen.getByRole('tab', { name: /^Invited/ }));
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith({ status: 'invited' }));
    expect(where()).toBe('/staff?tab=invited');
    expect(await screen.findByText('Akua Serwaa')).toBeInTheDocument();
    expect(screen.queryByText('Adwoa Darko')).toBeNull();
  });

  it('shows the columns: name with contact, role chips, type, pay text per kind, last active and status', async () => {
    renderPage();
    await screen.findByText('Adwoa Darko');
    const adwoa = within(rowOf('Adwoa Darko'));
    expect(adwoa.getByText('adwoa.darko@example.com')).toBeInTheDocument();
    expect(adwoa.getByText('Call rep')).toBeInTheDocument();
    expect(adwoa.getByText('Human')).toBeInTheDocument();
    expect(adwoa.getByText('GH₵8 per order confirmed by call and delivered + 10% upsell')).toBeInTheDocument();
    expect(adwoa.getByText('Active')).toBeInTheDocument();
    const kofi = within(rowOf('Kofi Appiah'));
    expect(kofi.getByRole('link', { name: 'Fee rule GH₵25 per delivered, kept from the cash they collect' })).toHaveAttribute('href', '/deliveries?partner=12');
    expect(within(rowOf('Confirm agent')).getByText('AI agent')).toBeInTheDocument();
    expect(within(rowOf('Confirm agent')).getByText('No payout')).toBeInTheDocument();
    expect(within(rowOf('Akua Serwaa')).getByText('Invited')).toBeInTheDocument();
    expect(within(rowOf('Akua Serwaa')).getByText('Invite sent 15 Oct')).toBeInTheDocument();
    expect(within(rowOf('Yaa Pokua')).getByText('Deactivated')).toBeInTheDocument();
  });

  it('a delivery partner pay text carries the fee amount: flat in the store currency, percent, or no rule set (still a link)', async () => {
    const percent = { ...KOFI, id: 21, name: 'Percy Ofori', feeRule: { ...KOFI.feeRule!, delivered: { basis: 'percent' as const, amount: 5 } } };
    const bare = { ...KOFI, id: 22, name: 'Bare Partner', feeRule: { ...KOFI.feeRule!, delivered: null } };
    svc.list.mockResolvedValue({ ...STAFF, staff: [KOFI, percent, bare] });
    renderPage();
    await screen.findByText('Kofi Appiah');
    expect(within(rowOf('Percy Ofori')).getByRole('link', { name: 'Fee rule 5% per delivered, kept from the cash they collect' })).toBeInTheDocument();
    expect(within(rowOf('Bare Partner')).getByRole('link', { name: 'No fee rule set' })).toHaveAttribute('href', '/deliveries?partner=22');
  });

  it('an AI agent row: type AI agent, No payout, last active = last key use (a dash when the key was never used)', async () => {
    const unused = { ...ROBO, id: 23, name: 'Idle agent', lastActiveAt: null };
    svc.list.mockResolvedValue({ ...STAFF, staff: [ROBO, unused] });
    renderPage();
    await screen.findByText('Confirm agent');
    const used = within(rowOf('Confirm agent'));
    expect(used.getByText('AI agent')).toBeInTheDocument();
    expect(used.getByText('No payout')).toBeInTheDocument();
    expect(used.queryByText('—')).not.toBeInTheDocument();
    expect(within(rowOf('Idle agent')).getByText('—')).toBeInTheDocument();
  });

  it('an empty tab shows an empty state; a failed list shows the retry block', async () => {
    svc.list.mockResolvedValue({ counts: { active: 0, invited: 0, deactivated: 0, deleted: 0 }, staff: [] });
    renderPage('/staff?tab=invited');
    expect(await screen.findByText('Nobody is invited right now')).toBeInTheDocument();
    expect(screen.getByText('0 on the team')).toBeInTheDocument();
  });
});

describe('Staff page: filters in the URL', () => {
  it('search and role combine with the tab, and all three are in the URL', async () => {
    renderPage('/staff?tab=active');
    await screen.findByText('Adwoa Darko');
    await userEvent.selectOptions(screen.getByLabelText('Filter by role'), '1');
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith({ status: 'active', role: '1' }));
    await userEvent.type(screen.getByLabelText('Search the team'), 'adwoa');
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith({ status: 'active', role: '1', q: 'adwoa' }));
    expect(where()).toBe('/staff?tab=active&role=1&q=adwoa');
  });

  it('opens from a link with the filters already set', async () => {
    renderPage('/staff?tab=invited&role=2&q=kofi');
    await screen.findByText('Adwoa Darko');
    expect(svc.list).toHaveBeenCalledWith({ status: 'invited', role: '2', q: 'kofi' });
    expect(screen.getByLabelText('Search the team')).toHaveValue('kofi');
    expect(screen.getByLabelText('Filter by role')).toHaveValue('2');
  });

  it('no match with a filter says so', async () => {
    svc.list.mockResolvedValue({ counts: STAFF.counts, staff: [] });
    renderPage('/staff?q=zzz');
    expect(await screen.findByText('No one matches')).toBeInTheDocument();
  });
});

describe('Staff page: invite', () => {
  const fillInvite = async () => {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Full name'), 'Esi Badu');
    await user.type(screen.getByLabelText('Email'), 'esi@example.com');
    return user;
  };

  it('?invite=1 opens the modal; closing it drops the parameter', async () => {
    renderPage('/staff?invite=1');
    expect(await screen.findByRole('dialog', { name: 'Invite a person' })).toBeInTheDocument();
    expect(where()).toBe('/staff?invite=1');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/staff');
  });

  it('an invite starts on the Call rep role, not on the first role of the list (Owner)', async () => {
    svc.roles.mockResolvedValue([{ roleId: 9, name: 'Owner', presetRole: 'super_admin' }, ...ROLES]);
    renderPage('/staff?invite=1');
    expect(await screen.findByLabelText('Role')).toHaveValue('1');
  });

  it('the Invite button opens it and puts invite=1 in the URL', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Invite a person/ }));
    expect(await screen.findByRole('dialog', { name: 'Invite a person' })).toBeInTheDocument();
    expect(where()).toBe('/staff?invite=1');
  });

  it('a sent invite shows a success toast, closes the modal and asks the table again', async () => {
    svc.invite.mockResolvedValue({ staff: { ...AKUA, name: 'Esi Badu' }, link: 'https://app/accept-invite?token=t', expiresAt: '2026-11-08T00:00:00Z', delivery: { channel: 'email', sent: true } });
    renderPage('/staff?invite=1');
    const user = await fillInvite();
    const calls = svc.list.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findByText('Invite sent to Esi Badu')).toBeInTheDocument();
    expect(svc.invite).toHaveBeenCalledWith(expect.objectContaining({ name: 'Esi Badu', email: 'esi@example.com', roleId: 1, channel: 'email', payMethod: 'per_order' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/staff');
    await waitFor(() => expect(svc.list.mock.calls.length).toBeGreaterThan(calls));
  });

  it('when the send fails the link shows to copy, once', async () => {
    svc.invite.mockResolvedValue({ staff: { ...AKUA, name: 'Esi Badu' }, link: 'https://app/accept-invite?token=t', expiresAt: '2026-11-08T00:00:00Z', delivery: { channel: 'email', sent: false, reason: 'Email provider not configured' } });
    renderPage('/staff?invite=1');
    const user = await fillInvite();
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite saved, not sent' });
    expect(within(dialog).getByLabelText('Invite link')).toHaveValue('https://app/accept-invite?token=t');
    expect(dialog).toHaveTextContent('Email provider not configured');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(copy).toHaveBeenCalledWith('https://app/accept-invite?token=t');
    expect(screen.queryByText('Invite sent to Esi Badu')).toBeNull();
  });

  it('checks the form: name, email and a phone for SMS; a delivery role adds vehicle, number and city', async () => {
    renderPage('/staff?invite=1');
    const user = userEvent.setup();
    await screen.findByLabelText('Full name');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(screen.getByText('Enter a name')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Send the invite by'), 'sms');
    expect(await screen.findByText('A phone number is needed to send the invite by SMS or WhatsApp')).toBeInTheDocument();
    expect(svc.invite).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Vehicle')).toBeNull();
    await user.selectOptions(within(screen.getByRole('dialog')).getByLabelText('Role'), '2');
    expect(screen.getByLabelText('Vehicle')).toBeInTheDocument();
    expect(screen.getByLabelText(/Vehicle number/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Location/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'On foot' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Commission per delivered confirmed order')).toBeNull();
  });

  it('a refusal of the API shows once as a toast and the modal stays', async () => {
    svc.invite.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'A user with this email already exists' } } }));
    renderPage('/staff?invite=1');
    const user = await fillInvite();
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(await screen.findAllByText('A user with this email already exists')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Invite a person' })).toBeInTheDocument();
  });

  it('resend and revoke are in the row menu of an invited person', async () => {
    svc.resend.mockResolvedValue({ staff: AKUA, link: 'l', expiresAt: 'x', delivery: { channel: 'email', sent: true } });
    renderPage();
    await screen.findByText('Akua Serwaa');
    let menu = await menuOf('Akua Serwaa');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Resend invite' }));
    expect(await screen.findByText('Invite sent to Akua Serwaa')).toBeInTheDocument();
    expect(svc.resend).toHaveBeenCalledWith(14, 'email');
    menu = await menuOf('Akua Serwaa');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Revoke invite' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Revoke 1 invite?');
    svc.revoke.mockResolvedValue(undefined);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(svc.revoke).toHaveBeenCalledWith(14));
  });
});

describe('Staff page: edit', () => {
  it('a call rep: company rule or a custom amount; a custom amount saves as commissionAmount', async () => {
    svc.update.mockResolvedValue({ ...ADWOA, commissionAmount: 9 });
    renderPage();
    await screen.findByText('Adwoa Darko');
    await userEvent.click(within(await menuOf('Adwoa Darko')).getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Adwoa Darko' });
    expect(within(dialog).getByRole('radio', { name: 'Use the company rule (GH₵8)' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Custom amount' }));
    const amount = within(dialog).getByLabelText('Amount per order');
    await userEvent.clear(amount);
    await userEvent.type(amount, '9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(11, expect.objectContaining({ firstName: 'Adwoa', lastName: 'Darko', payMethod: 'per_order', commissionAmount: 9 })));
    expect(await screen.findByText('Adwoa Darko saved')).toBeInTheDocument();
  });

  it('a delivery partner has no amount: it links to its fee rule and shows vehicle and city', async () => {
    renderPage();
    await screen.findByText('Kofi Appiah');
    await userEvent.click(within(await menuOf('Kofi Appiah')).getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Kofi Appiah' });
    expect(within(dialog).getByRole('link', { name: /fee rule of Kofi Appiah/ })).toHaveAttribute('href', '/deliveries?partner=12');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByLabelText('Amount per order')).toBeNull();
    expect(within(dialog).getByLabelText('Vehicle')).toHaveValue('Motorbike');
    expect(within(dialog).getByLabelText(/Location/)).toHaveValue('Kumasi');
    expect(within(dialog).getByLabelText('Role')).toHaveValue('2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(svc.update).toHaveBeenCalledWith(12, expect.not.objectContaining({ commissionAmount: expect.anything() })));
  });
});

describe('Staff page: row actions and the one confirm dialog', () => {
  it('delete and deactivate (no open orders) use the same dialog with the count; reactivate asks nothing', async () => {
    svc.remove.mockResolvedValue(undefined);
    svc.deactivate.mockResolvedValue(undefined);
    svc.reactivate.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('Adwoa Darko');
    await userEvent.click(within(await menuOf('Adwoa Darko')).getByRole('menuitem', { name: 'Delete' }));
    let dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Delete 1 person?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith(11));
    expect(await screen.findByText('Adwoa Darko was deleted')).toBeInTheDocument();

    await userEvent.click(within(await menuOf('Adwoa Darko')).getByRole('menuitem', { name: 'Deactivate' }));
    dialog = await screen.findByRole('alertdialog');
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(dialog).toHaveTextContent('Deactivate 1 person?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(svc.deactivate).toHaveBeenCalledWith(11));

    await userEvent.click(within(await menuOf('Yaa Pokua')).getByRole('menuitem', { name: 'Reactivate' }));
    await waitFor(() => expect(svc.reactivate).toHaveBeenCalledWith(15));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('deactivating a person with open orders asks who takes them, moves them, then deactivates', async () => {
    svc.workload.mockResolvedValue([{ id: 11, openOrders: 4, asRep: 4, asAgent: 0 }]);
    svc.list.mockImplementation(async (q: { status?: string; role?: string }) => (q.status === 'active' && q.role ? { counts: STAFF.counts, staff: [ADWOA, { ...ADWOA, id: 21, name: 'Nana Kyei' }] } : STAFF));
    reassign.mockResolvedValue(4);
    svc.deactivate.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('Adwoa Darko');
    await userEvent.click(within(await menuOf('Adwoa Darko')).getByRole('menuitem', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Deactivate Adwoa Darko?' });
    expect(dialog).toHaveTextContent('4 open orders');
    const options = within(dialog).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Nobody, leave them as they are', 'Nana Kyei']);
    await userEvent.selectOptions(within(dialog).getByLabelText('Who takes their open orders?'), '21');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(svc.deactivate).toHaveBeenCalledWith(11));
    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), 21);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refused deactivate (last Owner) shows its message once', async () => {
    svc.deactivate.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'The last Owner cannot be deactivated' } } }));
    renderPage();
    await screen.findByText('Adwoa Darko');
    await userEvent.click(within(await menuOf('Adwoa Darko')).getByRole('menuitem', { name: 'Deactivate' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findAllByText('The last Owner cannot be deactivated')).toHaveLength(1);
  });

  it('the menu follows the kind: AI agent has Manage key, a person Reset password, a rep and a partner Record payout', async () => {
    renderPage();
    await screen.findByText('Adwoa Darko');
    const names = async (n: string) => { const m = await menuOf(n); const out = within(m).getAllByRole('menuitem').map((i) => i.textContent); await userEvent.keyboard('{Escape}'); return out; };
    expect(await names('Confirm agent')).toEqual(['Manage key', 'Deactivate', 'Delete']); // no Edit, Reset password or payout
    expect(await names('Adwoa Darko')).toEqual(['Edit', 'Record payout', 'Reset password', 'Deactivate', 'Delete']);
    expect(await names('Yaa Pokua')).toEqual(['Edit', 'Reactivate', 'Delete']);
    await userEvent.click(within(await menuOf('Kofi Appiah')).getByRole('menuitem', { name: 'Record payout' }));
    expect(navigated).toHaveBeenCalledWith('/deliveries?partner=12');
    await userEvent.click(within(await menuOf('Adwoa Darko')).getByRole('menuitem', { name: 'Record payout' }));
    expect(navigated).toHaveBeenCalledWith('/finance?financial-tab=rep-commissions');
    await userEvent.click(within(await menuOf('Confirm agent')).getByRole('menuitem', { name: 'Manage key' }));
    expect(navigated).toHaveBeenCalledWith('/connections');
    expect(ROBO.kind).toBe('ai_agent');
  });

  it('reset password asks for a new password with the same rules', async () => {
    svc.resetPassword.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('Adwoa Darko');
    await userEvent.click(within(await menuOf('Adwoa Darko')).getByRole('menuitem', { name: 'Reset password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset password for Adwoa Darko' });
    await userEvent.type(within(dialog).getByLabelText('New password'), 'weak');
    await userEvent.type(within(dialog).getByLabelText('Confirm password'), 'weak');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    expect(within(dialog).getByText('The password does not meet the rules below')).toBeInTheDocument();
    expect(svc.resetPassword).not.toHaveBeenCalled();
    await userEvent.clear(within(dialog).getByLabelText('New password'));
    await userEvent.clear(within(dialog).getByLabelText('Confirm password'));
    await userEvent.type(within(dialog).getByLabelText('New password'), 'Abcdef1!');
    await userEvent.type(within(dialog).getByLabelText('Confirm password'), 'Abcdef1!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(svc.resetPassword).toHaveBeenCalledWith(11, 'Abcdef1!'));
  });
});

describe('Staff page: permanent delete', () => {
  const deleted = { ...YAA, status: 'deleted' as const };
  beforeEach(() => svc.list.mockResolvedValue({ counts: { ...STAFF.counts, deleted: 1 }, staff: [deleted] }));

  it('needs the email typed, lists what is removed and unlinked, and only the Owner sees it', async () => {
    svc.removePermanently.mockResolvedValue(undefined);
    renderPage('/staff?tab=deleted');
    await screen.findByText('Yaa Pokua');
    await userEvent.click(within(await menuOf('Yaa Pokua')).getByRole('menuitem', { name: 'Delete for good' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 1 person for good?' });
    expect(dialog).toHaveTextContent('Removed:');
    expect(dialog).toHaveTextContent('Unlinked:');
    const action = within(dialog).getByRole('button', { name: 'Delete for good' });
    expect(action).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(`Type ${deleted.email} to confirm`), 'wrong@example.com');
    expect(action).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText(`Type ${deleted.email} to confirm`));
    await userEvent.type(within(dialog).getByLabelText(`Type ${deleted.email} to confirm`), deleted.email);
    expect(action).toBeEnabled();
    await userEvent.click(action);
    await waitFor(() => expect(svc.removePermanently).toHaveBeenCalledWith(15, deleted.email));
  });

  it('an admin (not the Owner) is not offered permanent delete', async () => {
    useAuthStore.setState({ user: { id: 2, role: 'admin' } as never });
    renderPage('/staff?tab=deleted');
    await screen.findByText('Yaa Pokua');
    const menu = await menuOf('Yaa Pokua');
    expect(within(menu).queryByRole('menuitem', { name: 'Delete for good' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Restore' })).toBeInTheDocument();
  });
});

describe('Staff page: who may do what', () => {
  it('without users:create there is no Invite button and without users:update no actions', async () => {
    permitted = false;
    renderPage();
    await screen.findByText('Adwoa Darko');
    expect(screen.queryByRole('button', { name: /Invite a person/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Adwoa Darko' })).toBeNull();
  });

  it('the sidebar has Staff & roles pointing at /staff', () => {
    const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === 'staff');
    expect(item?.to).toBe('/staff');
  });
});

