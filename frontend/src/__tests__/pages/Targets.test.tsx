import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/ui-v2';
import { Targets } from '../../pages/Targets';
import { useFinancialStore } from '../../stores/financialStore';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { ATTAINMENT, CALCULATORS, SETTINGS, TREE } from '../fixtures/targetsTree';
import type { RewardSettings } from '../../services/targets.service';

const svc = vi.hoisted(() => ({
  tree: vi.fn(), calculators: vi.fn(), daily: vi.fn(), attainment: vi.fn(), rewardSettings: vi.fn(), save: vi.fn(), update: vi.fn(), remove: vi.fn(),
}));
vi.mock('../../services/targets.service', async (orig) => ({ ...(await orig<typeof import('../../services/targets.service')>()), targetsService: svc }));

let canEdit = true;
vi.mock('../../hooks/usePermissions', () => ({ usePermissions: () => ({ can: () => canEdit, user: { role: 'admin' } }) }));

const navigated = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigated }));

const renderPage = () => render(<MemoryRouter><ToastProvider><Targets /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T12:00:00'));
  clearBlockCache();
  canEdit = true;
  Object.values(svc).forEach((f) => f.mockReset());
  svc.tree.mockResolvedValue(TREE);
  svc.attainment.mockResolvedValue(ATTAINMENT);
  svc.rewardSettings.mockResolvedValue(SETTINGS);
  svc.calculators.mockResolvedValue(CALCULATORS);
  svc.daily.mockImplementation(async (metric: string) => (metric === 'failed_delivery_calls_per_day'
    ? { metric, date: '2026-10-17', id: 90, unit: 'count', target: 15, actual: 6, message: null }
    : { metric, date: '2026-10-17', id: 91, unit: 'count', target: 40, actual: null, message: 'No data for this metric' }));
});
afterEach(() => vi.useRealTimers());

describe('Targets page: the tree', () => {
  it('writes the North Star card from the tree: title and the tag with done %, pts behind and margin', async () => {
    renderPage();
    expect(await screen.findByText('2026 North Star: GH₵1,800,000 delivered revenue at 35% margin')).toBeInTheDocument();
    expect(screen.getByText('77% done · 3 pts behind · margin 12% of 35%')).toBeInTheDocument();
    expect(svc.tree).toHaveBeenCalledWith(2026, '2026-10');
  });

  it('shows each quarter with its status word and margin; n/a when the books have nothing', async () => {
    renderPage();
    await screen.findByText(/North Star:/);
    expect(screen.getByText('GH₵372k of 360k')).toBeInTheDocument();
    expect(screen.getAllByText('Revenue hit, margin missed').length).toBe(2);
    expect(screen.getByText('Margin 11% of 35%')).toBeInTheDocument();
    expect(screen.getByText('Margin n/a')).toBeInTheDocument(); // Q2: no margin data
    expect(screen.getByText('Margin -16% of 35%')).toBeInTheDocument();
    expect(screen.getByText('GH₵92k of 540k')).toBeInTheDocument();
  });

  it('a future month shows its target only: no margin, no status', async () => {
    renderPage();
    const nov = await screen.findByRole('button', { name: 'November target GH₵180k, open Finance' });
    expect(nov).toHaveTextContent('Nov');
    expect(nov).toHaveTextContent('180k');
    expect(nov.querySelector('em')).toBeNull();
    const oct = screen.getByRole('button', { name: 'October GH₵92k delivered, open Finance' });
    expect(oct.querySelector('em')).toHaveTextContent('-16%');
  });

  it('a month click opens Finance for that month', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'October GH₵92k delivered, open Finance' }));
    expect(useFinancialStore.getState().dateRange).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(navigated).toHaveBeenCalledWith('/finance');
  });

  it('without a North Star it says so and has no dead button', async () => {
    svc.tree.mockResolvedValue({ ...TREE, northStar: null, quarters: [], months: [] });
    renderPage();
    expect(await screen.findByText('No North Star yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit North Star/ })).not.toBeInTheDocument();
  });

  it('shows an error with Retry when the tree fails', async () => {
    svc.tree.mockRejectedValue(new Error('down'));
    renderPage();
    expect(await screen.findByText('The targets did not load')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Targets page: targets by role', () => {
  const callRep = async () => {
    renderPage();
    const heading = await screen.findByText('October targets by role');
    return heading.closest('.card') as HTMLElement;
  };

  it('titles the table with the month and shows the feeds line from the calculators', async () => {
    const card = await callRep();
    expect(within(card).getByText(/Feeds October GH₵180k: 723 delivered orders × GH₵249 planned order value/)).toBeInTheDocument();
  });

  it('a role with no holder reads Vacant; a role with neither target nor holder is not listed', async () => {
    const card = await callRep();
    expect(within(card).getAllByText('Vacant').length).toBeGreaterThanOrEqual(1);
    expect(within(card).getByText('Delivery')).toBeInTheDocument();
    expect(within(card).queryByText('Stock keeper')).not.toBeInTheDocument();
  });

  it('the reward cell reads the Rewards setting; an AI agent shows No payout', async () => {
    const card = await callRep();
    const adwoa = within(card).getByText('Adwoa Darko').closest('tr') as HTMLElement;
    expect(within(adwoa).getByText('GH₵300 bonus')).toBeInTheDocument();
    expect(within(adwoa).getByText('253 of 423')).toBeInTheDocument();
    const agent = within(card).getByText('Confirm agent').closest('tr') as HTMLElement;
    expect(within(agent).getByText('No payout')).toBeInTheDocument();
    expect(within(agent).getByText('AI agent')).toBeInTheDocument();
  });

  it('changing the Rewards setting changes the cell (nothing is typed in the page)', async () => {
    const changed: RewardSettings = { ...SETTINGS, tiers: [{ ...SETTINGS.tiers[0], tier100: { amount: 350, dayOff: false, payout: true } }] };
    svc.rewardSettings.mockResolvedValue(changed);
    const card = await callRep();
    expect((await within(card).findAllByText('GH₵350 bonus')).length).toBeGreaterThanOrEqual(1);
    expect(within(card).queryByText('GH₵300 bonus')).not.toBeInTheDocument();
  });

  it('a holder with no target shows Set a target; the group bar sums the holders against the role target', async () => {
    const card = await callRep();
    const nana = within(card).getByText('Nana Kyei').closest('tr') as HTMLElement;
    expect(within(nana).getAllByText('Set a target').length).toBeGreaterThanOrEqual(1);
    expect(within(card).getByText('363 of 723 · 50% of role target')).toBeInTheDocument();
  });

  it('with the reward reads failing, the table still shows with a dash in the reward cell', async () => {
    svc.rewardSettings.mockRejectedValue(new Error('403'));
    svc.attainment.mockRejectedValue(new Error('500'));
    const card = await callRep();
    const adwoa = within(card).getByText('Adwoa Darko').closest('tr') as HTMLElement;
    expect(within(adwoa).getByText('—', { selector: '.tg-reward' })).toBeInTheDocument();
  });

  it('daily targets list with their numbers; a metric with no data says so', async () => {
    const card = await callRep();
    expect(within(card).getByText(/Daily target: Failed delivery calls/)).toBeInTheDocument();
    expect(within(card).getByText(/15 a day\. 6 so far today\./)).toBeInTheDocument();
    expect(within(card).getByText(/40 a day\. No data for this metric\./)).toBeInTheDocument();
  });

  it('never writes an 80% tier or airtime', async () => {
    await callRep();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/80\s?%/);
    expect(text).not.toMatch(/airtime/i);
  });
});

describe('Targets page: add, edit and delete', () => {
  it('a person without edit rights sees no buttons that change anything', async () => {
    canEdit = false;
    renderPage();
    await screen.findByText('October targets by role');
    expect(screen.queryByRole('button', { name: /Add target/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('Add target validates: a role, and a value greater than 0', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Add target/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Value'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add target' }));
    expect([...dialog.querySelectorAll('.err')].map((e) => e.textContent)).toEqual(['Choose a role', 'Enter a value greater than 0']);
    expect(svc.save).not.toHaveBeenCalled();
  });

  it('saves a role target and asks again', async () => {
    svc.save.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Add target/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), '7');
    await userEvent.type(within(dialog).getByLabelText('Value'), '100000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add target' }));
    await waitFor(() => expect(svc.save).toHaveBeenCalledWith({ scope: 'role', metric: 'revenue', unit: 'money', value: 100000, period: '2026-10', roleId: 7 }));
    expect(await screen.findByText('Target added')).toBeInTheDocument();
  });

  it('shows the server message when a save is refused (the sum difference)', async () => {
    svc.save.mockRejectedValue({ response: { data: { message: 'The person targets add up to 800.00 but the role is 723.00 (over by 77.00). Difference: 77.00' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Add target/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), '7');
    await userEvent.type(within(dialog).getByLabelText('Value'), '800');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add target' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Difference: 77.00');
  });

  it('a daily activity target saves from the form', async () => {
    svc.save.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /Add target/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Target for'), 'daily');
    expect(within(dialog).queryByLabelText('Role')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Value'), '15');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add target' }));
    await waitFor(() => expect(svc.save).toHaveBeenCalledWith({ scope: 'daily', metric: 'failed_delivery_calls_per_day', unit: 'count', value: 15, period: '2026-10-17' }));
  });

  it('Delete asks once with the one confirm dialog, then removes the target', async () => {
    svc.remove.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete the target of Adwoa Darko' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Delete the target of Adwoa Darko?')).toBeInTheDocument();
    expect(svc.remove).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(svc.remove).toHaveBeenCalledWith(41));
  });
});
