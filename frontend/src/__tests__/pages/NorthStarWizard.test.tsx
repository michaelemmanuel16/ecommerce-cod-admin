import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { configure, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Onboarding } from '../../pages/Onboarding';
import { NorthStarTab } from '../../pages/settings/NorthStarTab';
import { perMonth } from '../../pages/northStar/model';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import type { OnboardingStatus } from '../../services/onboarding.service';
import { CALC, DRIVERS, EMPTY, PREVIEWS, SAVED } from '../fixtures/northStar';
import { TREE } from '../fixtures/targetsTree';

const onboarding = vi.hoisted(() => ({ getStatus: vi.fn(), saveStore: vi.fn(), addPartner: vi.fn(), skipPartner: vi.fn(), saveNorthStarProgress: vi.fn() }));
const targets = vi.hoisted(() => ({ drivers: vi.fn(), tree: vi.fn(), preview: vi.fn(), calculators: vi.fn(), saveNorthStar: vi.fn(), saveDrivers: vi.fn(), save: vi.fn() }));
vi.mock('../../services/onboarding.service', () => ({ onboardingService: onboarding }));
vi.mock('../../services/targets.service', async (orig) => ({ ...(await orig<typeof import('../../services/targets.service')>()), targetsService: targets }));
vi.mock('../../services/admin.service', () => ({ adminService: { getSystemConfig: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../services/billing.service', () => ({
  billingService: { getSubscription: vi.fn().mockResolvedValue({ subscriptionStatus: 'active', plan: { name: 'free', displayName: 'Free' }, billingEnabled: false }), startSubscription: vi.fn() },
}));

// The split and the tiles come after a 300 ms pause; a loaded machine needs more than the default second.
configure({ asyncUtilTimeout: 4000 });

const status = (step = 3, done = false): OnboardingStatus => ({
  onboardingCompleted: true, country: 'Ghana', currency: 'GHS', northStar: { step, done },
  steps: [{ step: 1, key: 'store', done: true }, { step: 2, key: 'partner', done: true }],
});

function Where() {
  const l = useLocation();
  return <span data-testid="where">{l.pathname}{l.search}</span>;
}
const renderWizard = (path = '/onboarding') => render(
  <MemoryRouter initialEntries={[path]}><Routes><Route path="/onboarding" element={<Onboarding />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>,
);
const refreshPermissions = vi.fn();
const patchUser = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T12:00:00'));
  Object.values({ ...onboarding, ...targets }).forEach((f) => f.mockReset());
  onboarding.getStatus.mockResolvedValue(status());
  onboarding.saveNorthStarProgress.mockResolvedValue(undefined);
  targets.drivers.mockResolvedValue(DRIVERS);
  targets.tree.mockResolvedValue(EMPTY);
  targets.preview.mockImplementation(async (_year: number, _annual: number, mode: 'even' | 'grow' | 'custom', custom?: number[]) =>
    (mode === 'custom' ? { quarters: custom!.map((v) => `${v}.00`), months: custom!.map((v) => Array(3).fill(`${v / 3}.00`)), kept: 0 } : PREVIEWS[mode]));
  targets.calculators.mockResolvedValue(CALC);
  targets.saveNorthStar.mockResolvedValue(undefined);
  targets.saveDrivers.mockResolvedValue(DRIVERS);
  targets.save.mockResolvedValue(undefined);
  refreshPermissions.mockReset().mockResolvedValue(undefined);
  patchUser.mockReset();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useAuthStore.setState({ user: { id: 1, firstName: 'Ama', role: 'super_admin', preferences: {} } as never, isAuthenticated: true, patchUser, refreshPermissions } as never);
});
afterEach(() => vi.useRealTimers());

/** The step is ready when its fields have loaded (the heading shows first). */
const ready = () => screen.findByLabelText(/Annual North Star/);
const quarterTile = (n: number) => screen.getByText(`Q${n}`).closest('.nsq') as HTMLElement;

describe('wizard step 3: Set your North Star', () => {
  it('opens at step 3 after the store steps and shows the default 1,800,000 split on Grow', async () => {
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'What is your goal for 2026?' })).toBeInTheDocument();
    expect(await screen.findByLabelText(/Annual North Star/)).toHaveValue('1800000');
    await waitFor(() => expect(within(quarterTile(1)).getByText('GH₵360k')).toBeInTheDocument());
    expect(within(quarterTile(4)).getByText('GH₵540k')).toBeInTheDocument();
    expect(within(quarterTile(1)).getByText('GH₵120k a month')).toBeInTheDocument();
    // months that differ (a kept past month) are each shown, not the first one as "a month"
    expect(perMonth(['180000.00', '280000.00', '280000.00'], 'GHS')).toBe('GH₵180k · 280k · 280k');
    expect(perMonth(['120000.00', '120000.00', '120000.00'], 'GHS')).toBe('GH₵120k a month');
    expect(screen.getByLabelText('Confirmation rate target (%)')).toHaveValue('70');
    expect(screen.getByLabelText('Delivery success target (%)')).toHaveValue('60');
    expect(screen.getByLabelText('Net margin target (%)')).toHaveValue('35');
  });

  it('the growth mode changes the quarter tiles', async () => {
    renderWizard();
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Even each month' }));
    await waitFor(() => expect(within(quarterTile(1)).getByText('GH₵450k')).toBeInTheDocument());
    expect(within(quarterTile(4)).getByText('GH₵450k')).toBeInTheDocument();
    expect(targets.preview).toHaveBeenLastCalledWith(2026, 1_800_000, 'even', undefined);
  });

  it('shows the calculator tiles from the API: orders a day and max cost per order, with the working', async () => {
    renderWizard();
    expect(await screen.findByText('56')).toBeInTheDocument();
    expect(screen.getByText('GH₵8.7k')).toBeInTheDocument();
    expect(screen.getByText(/GH₵180k ÷ GH₵249 = 723 delivered orders\. ÷ 70% ÷ 60% = 1,721 orders\. ÷ 31 days in October = 56 a day\./)).toBeInTheDocument();
    expect(targets.calculators).toHaveBeenCalledWith(expect.objectContaining({ month: '2026-10', revenueTarget: 180_000, aov: 245, confirmationRate: 70, deliverySuccessRate: 60 }));
  });

  it('Custom quarters that do not add up show the gap in red and block the save', async () => {
    renderWizard();
    await ready();
    await waitFor(() => expect(within(quarterTile(1)).getByText('GH₵360k')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const q1 = screen.getByLabelText('Q1 amount');
    expect(q1).toHaveValue('360000'); // starts from the split on screen
    await userEvent.clear(q1);
    await userEvent.type(q1, '260000');
    expect(await screen.findByText(/The quarters are GH₵100k short of the annual figure/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save and set driver targets' }));
    expect(screen.getAllByText('The four quarters must add up to the annual figure.').length).toBeGreaterThan(0);
    expect(targets.saveNorthStar).not.toHaveBeenCalled();
  });

  it('saves the tree and the drivers, keeps the step, and moves to step 4', async () => {
    targets.tree.mockResolvedValueOnce(EMPTY).mockResolvedValue(EMPTY);
    renderWizard();
    await ready();
    await waitFor(() => expect(within(quarterTile(1)).getByText('GH₵360k')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Save and set driver targets' }));
    await waitFor(() => expect(targets.saveNorthStar).toHaveBeenCalledWith({ year: 2026, annual: 1_800_000, mode: 'grow' }));
    expect(targets.saveDrivers).toHaveBeenCalledWith(2026, { confirmationRate: 70, deliverySuccessRate: 60, netMargin: 35, plannedAov: null });
    await waitFor(() => expect(onboarding.saveNorthStarProgress).toHaveBeenCalledWith(4));
    expect(await screen.findByRole('heading', { name: 'Driver targets' })).toBeInTheDocument();
  });

  it('a typed AOV is saved with the tree and "Reset to last 30 days" puts the default back', async () => {
    renderWizard();
    const aov = await screen.findByLabelText('Planned average order');
    expect(aov).toHaveValue('245');
    expect(screen.getByText(/Last 30 days of delivered orders \(automatic\)/)).toBeInTheDocument();
    await userEvent.clear(aov);
    await userEvent.type(aov, '249');
    expect(screen.getByText(/Your own figure/)).toBeInTheDocument();
    await waitFor(() => expect(targets.calculators).toHaveBeenLastCalledWith(expect.objectContaining({ aov: 249 })));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to last 30 days' }));
    expect(screen.getByLabelText('Planned average order')).toHaveValue('245');
    expect(screen.getByText(/Last 30 days of delivered orders \(automatic\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset to last 30 days' })).not.toBeInTheDocument();
  });

  it('a typed AOV goes with the tree on save', async () => {
    renderWizard();
    const aov = await screen.findByLabelText('Planned average order');
    await userEvent.clear(aov);
    await userEvent.type(aov, '249');
    await waitFor(() => expect(within(quarterTile(1)).getByText('GH₵360k')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Save and set driver targets' }));
    await waitFor(() => expect(targets.saveNorthStar).toHaveBeenCalledWith({ year: 2026, annual: 1_800_000, mode: 'grow', plannedAov: 249 }));
    expect(targets.saveDrivers).toHaveBeenCalledWith(2026, expect.not.objectContaining({ plannedAov: null }));
  });

  it('with no delivered orders in 30 days the AOV is empty and required: the save is blocked', async () => {
    targets.drivers.mockResolvedValue({ ...DRIVERS, plannedAov: { value: null, source: 'auto', last30Days: null, deliveredOrders: 0, required: true } });
    renderWizard();
    expect(await screen.findByLabelText('Planned average order')).toHaveValue('');
    expect(screen.getByText(/No orders were delivered in the last 30 days: type your planned average order/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save and set driver targets' }));
    expect(screen.getAllByText(/no orders were delivered in the last 30 days, so there is no default/).length).toBeGreaterThan(0);
    expect(targets.saveNorthStar).not.toHaveBeenCalled();
  });

  it('a rate of 0 is refused before anything is saved', async () => {
    renderWizard();
    const conf = await screen.findByLabelText('Confirmation rate target (%)');
    await userEvent.clear(conf);
    await userEvent.type(conf, '0');
    await waitFor(() => expect(within(quarterTile(1)).getByText('GH₵360k')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Save and set driver targets' }));
    expect(screen.getByText('Confirmation rate must be more than 0 and not more than 100.')).toBeInTheDocument();
    expect(targets.saveNorthStar).not.toHaveBeenCalled();
  });

  it('re-running with past months saved shows the warning that they do not change', async () => {
    targets.tree.mockResolvedValue(SAVED);
    renderWizard('/onboarding?step=3');
    expect(await screen.findByText(/Targets for past months do not change/)).toBeInTheDocument();
    expect(screen.getByText(/Set on 2 Jan 2026/)).toBeInTheDocument();
  });

  it('a saved tree opens with its own amount and the mode its quarters follow', async () => {
    targets.tree.mockResolvedValue({ ...SAVED, quarters: SAVED.quarters.map((q, i) => ({ ...q, value: 450_000 + 0 * i })) });
    renderWizard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Even each month' })).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('wizard steps 4 to 6 and resume', () => {
  it('resumes at the saved step', async () => {
    onboarding.getStatus.mockResolvedValue(status(5));
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Invite your team' })).toBeInTheDocument();
  });

  it('step 4 shows the role targets that come from the drivers and saves them with the call rep split', async () => {
    onboarding.getStatus.mockResolvedValue(status(4));
    targets.tree.mockResolvedValue(TREE);
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Driver targets' })).toBeInTheDocument();
    expect(await screen.findByText('723 confirmed orders that get delivered, counted at month close')).toBeInTheDocument();
    expect(screen.getByText('60% delivery success')).toBeInTheDocument();
    expect(screen.getByText('Cost per order under GH₵8.7k')).toBeInTheDocument();
    // the saved split starts in the boxes (423 and 250); Nana has none yet
    expect(screen.getByLabelText('Adwoa Darko')).toHaveValue('423');
    await userEvent.type(screen.getByLabelText('Nana Kyei'), '50');
    expect(screen.getByText('Total 723 of 723.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save driver targets and continue' }));
    await waitFor(() => expect(targets.save).toHaveBeenCalledWith({ scope: 'role', metric: 'confirmed_delivered', unit: 'count', value: 723, period: '2026-10', roleId: 7 }));
    expect(targets.save).toHaveBeenCalledWith({ scope: 'role', metric: 'delivery_success_rate', unit: 'percent', value: 60, period: '2026-10', roleId: 8 });
    expect(targets.save).toHaveBeenCalledWith({ scope: 'person', metric: 'confirmed_delivered', unit: 'count', value: 423, period: '2026-10', roleId: 7, userId: 101 });
    await waitFor(() => expect(onboarding.saveNorthStarProgress).toHaveBeenCalledWith(5));
  });

  it('step 4: a split above the role target is refused', async () => {
    onboarding.getStatus.mockResolvedValue(status(4));
    targets.tree.mockResolvedValue(TREE);
    renderWizard();
    await screen.findByText('723 confirmed orders that get delivered, counted at month close');
    const adwoa = screen.getByLabelText('Adwoa Darko');
    await userEvent.clear(adwoa);
    await userEvent.type(adwoa, '800');
    expect(screen.getByRole('alert')).toHaveTextContent('Total 1,050 is 327 over the role target of 723.');
    expect(screen.getByRole('button', { name: 'Save driver targets and continue' })).toBeDisabled();
  });

  it('step 5 opens Staff & roles with the invite form: /staff?invite=1', async () => {
    onboarding.getStatus.mockResolvedValue(status(5));
    renderWizard();
    await userEvent.click(await screen.findByRole('button', { name: /Invite people in Staff/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/staff?invite=1'));
    expect(onboarding.saveNorthStarProgress).toHaveBeenCalledWith(5);
  });

  it('step 6 is one line and a link to Rewards: no tier amounts, no tier words; Finish sets the setup done', async () => {
    onboarding.getStatus.mockResolvedValue(status(6));
    renderWizard();
    expect(await screen.findByRole('heading', { name: 'Rewards' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open Rewards/ });
    expect(link).toHaveAttribute('href', '/settings?tab=rewards');
    const body = document.querySelector('.wbody')!.textContent ?? '';
    expect(body).not.toMatch(/tier|bonus|day off|airtime|80\s?%|GH₵\s?\d/i);
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));
    await waitFor(() => expect(onboarding.saveNorthStarProgress).toHaveBeenCalledWith(6, true));
    expect(refreshPermissions).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: "You're all set" })).toBeInTheDocument();
  });

  it('the rail marks the steps before the saved one as done and every step opens once the store is set up', async () => {
    onboarding.getStatus.mockResolvedValue(status(5));
    renderWizard();
    await screen.findByRole('heading', { name: 'Invite your team' });
    expect(screen.getByRole('button', { name: /Set your North Star/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Rewards/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /Driver targets/ }));
    await waitFor(() => expect(onboarding.saveNorthStarProgress).toHaveBeenCalledWith(4));
  });
});

describe('Settings tab: North Star and targets', () => {
  const renderTab = (editable: boolean) => render(<MemoryRouter><ToastProvider><NorthStarTab editable={editable} /></ToastProvider></MemoryRouter>);

  it('the Owner edits: Save shows what changes, then Confirm saves; past months do not change', async () => {
    targets.tree.mockResolvedValue(SAVED);
    renderTab(true);
    await screen.findByLabelText(/Annual North Star/);
    await userEvent.click(screen.getByRole('button', { name: 'Even each month' }));
    await waitFor(() => expect(within(quarterTile(1)).getByText('GH₵450k')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Save targets' }));
    const confirm = await screen.findByRole('group', { name: 'Confirm the new targets' });
    expect(confirm).toHaveTextContent('Targets for past months do not change');
    expect(confirm).toHaveTextContent('Q1: GH₵360k to GH₵450k');
    expect(targets.saveNorthStar).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Confirm and save' }));
    await waitFor(() => expect(targets.saveNorthStar).toHaveBeenCalledWith({ year: 2026, annual: 1_800_000, mode: 'even' }));
    expect(await screen.findByText('North Star saved')).toBeInTheDocument();
  });

  it('shows Set on, the four read-only tiles, the one-line Rewards link, and no reward tiers', async () => {
    targets.tree.mockResolvedValue(SAVED);
    renderTab(true);
    await screen.findByLabelText(/Annual North Star/);
    expect(screen.getByText(/Set on 2 Jan 2026/)).toBeInTheDocument();
    for (const label of ['Orders a day you need', 'Confirmation rate', 'Delivery success rate', 'Max cost per order']) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Rewards' })).toHaveAttribute('href', '/settings?tab=rewards');
    expect(screen.getByText('Rewards are set in Rewards.')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/tier|bonus|day off|airtime|80\s?%/i);
  });

  it('is read only for a person who is not the Owner: fields disabled, no Save, no Edit in setup', async () => {
    targets.tree.mockResolvedValue(SAVED);
    renderTab(false);
    expect(await screen.findByLabelText(/Annual North Star/)).toBeDisabled();
    expect(screen.getByLabelText('Net margin target (%)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Even each month' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save targets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit in setup/ })).not.toBeInTheDocument();
    expect(screen.getByText(/You can view this section but not change it/)).toBeInTheDocument();
  });
});
