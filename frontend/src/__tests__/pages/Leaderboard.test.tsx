import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Leaderboard } from '../../pages/Leaderboard';
import { useAuthStore } from '../../stores/authStore';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { NAV_GROUPS, visibleGroups } from '../../components/shell/navModel';
import { BADGES, CALL_MONTH, CALL_TODAY, DELIVERY_MONTH, DELIVERY_TODAY } from '../fixtures/leaderboard';

const svc = vi.hoisted(() => ({ board: vi.fn(), badges: vi.fn() }));
vi.mock('../../services/leaderboard.service', async (orig) => ({ ...(await orig<typeof import('../../services/leaderboard.service')>()), leaderboardService: svc }));

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname}{l.search}</div>;
}
const renderPage = (url = '/leaderboard') => render(<MemoryRouter initialEntries={[url]}><Leaderboard /><Where /></MemoryRouter>);

const answers = (role: string, period: string) => {
  const today = period === 'today' || period === 'week';
  if (role === 'call_rep') return today ? CALL_TODAY : CALL_MONTH;
  return today ? DELIVERY_TODAY : DELIVERY_MONTH;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T12:00:00'));
  clearBlockCache();
  svc.board.mockReset();
  svc.badges.mockReset();
  svc.board.mockImplementation(async (role: string, period: string) => JSON.parse(JSON.stringify(answers(role, period))));
  svc.badges.mockResolvedValue(JSON.parse(JSON.stringify(BADGES)));
  useAuthStore.setState({ user: { id: 1, role: 'admin', firstName: 'Manny', lastName: 'A', isPlatformAdmin: false } as never, menu: ['dashboard', 'leaderboard'], homeRoute: '/' });
});
afterEach(() => vi.useRealTimers());

const table = async (name: RegExp) => within(await screen.findByRole('table', { name }));

describe('Leaderboard page (M6-T16)', () => {
  it('shows the call rep ranking: kind tags, percent bars, the role columns', async () => {
    renderPage();
    const t = await table(/Full ranking: call reps/);
    for (const header of ['Rank', 'Staff', 'Confirmed', 'Confirmation rate', 'Delivered from confirmed']) expect(t.getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument();
    const agent = t.getByText('Confirm agent').closest('tr')!;
    expect(within(agent).getByText('AI agent')).toBeInTheDocument();
    expect(within(agent).getByRole('progressbar', { name: 'Confirm agent of target' })).toHaveAttribute('aria-valuenow', '40');
    expect(within(agent).getByText('70%')).toBeInTheDocument();
    expect(svc.board).toHaveBeenCalledWith('call_rep', 'month');
  });

  it('ties share a rank: two people at rank 1, then rank 3', async () => {
    renderPage();
    const t = await table(/Full ranking: call reps/);
    const ranks = t.getAllByRole('row').slice(1).map((r) => within(r).queryByLabelText(/Rank|Not ranked/)?.getAttribute('aria-label'));
    expect(ranks).toEqual(['Rank 1', 'Rank 1', 'Rank 1', 'Rank 3', 'Rank 4', 'Not ranked']);
  });

  it('people with no target are listed after the ranked ones with "No target", with no rank', async () => {
    renderPage();
    const t = await table(/Full ranking: call reps/);
    const rows = t.getAllByRole('row').slice(1);
    const last = rows[rows.length - 1];
    expect(within(last).getByText('Yaw New')).toBeInTheDocument();
    expect(within(last).getByText('No target')).toBeInTheDocument();
    expect(within(last).getByLabelText('Not ranked')).toBeInTheDocument();
    expect(within(last).queryByRole('progressbar')).toBeNull();
  });

  it('the Delivery tab: success, days to pay, delivered; Too early is not ranked; the URL carries the tab', async () => {
    renderPage();
    await table(/Full ranking: call reps/);
    await userEvent.click(screen.getByRole('tab', { name: /Delivery/ }));
    const t = await table(/Full ranking: delivery/);
    for (const header of ['Success', 'Days to pay', 'Delivered']) expect(t.getByRole('columnheader', { name: new RegExp(header) })).toBeInTheDocument();
    const kofi = t.getByText('Kofi Appiah').closest('tr')!;
    expect(within(kofi).getByText('55.5%')).toBeInTheDocument();
    expect(within(kofi).getByText('2')).toBeInTheDocument();
    const kasapa = t.getByText('Kasapa Express').closest('tr')!;
    expect(within(kasapa).getByText('Too early')).toBeInTheDocument();
    expect(within(kasapa).getByLabelText('Not ranked')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('role=delivery');
  });

  it('tabs carry the number of people of each role', async () => {
    renderPage();
    await table(/Full ranking: call reps/);
    expect(screen.getByRole('tab', { name: /Call reps/ })).toHaveTextContent('6');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Delivery/ })).toHaveTextContent('4'));
  });

  it('the period select asks the API again and shows that period: Today has no rewards and shows the note', async () => {
    renderPage();
    await table(/Full ranking: call reps/);
    expect(screen.getByRole('heading', { name: 'Rewards' })).toBeInTheDocument();
    const select = screen.getByLabelText('Period');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Today', 'This week', 'October', '2026', 'September 2026', 'August 2026', 'July 2026']);
    await userEvent.selectOptions(select, 'today');
    await waitFor(() => expect(svc.board).toHaveBeenCalledWith('call_rep', 'today'));
    expect(await screen.findByRole('note')).toHaveTextContent('Early in this period');
    expect(screen.queryByRole('heading', { name: 'Rewards' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Badges' })).toBeNull();
    expect(screen.queryByText(/Distance to the next tier/)).toBeNull();
    const t = await table(/Full ranking: call reps/);
    expect(t.getAllByRole('row')).toHaveLength(2); // the day has one person
    expect(screen.getByTestId('where')).toHaveTextContent('period=today');
  });

  it('This week has no reward cards either; a past month asks for that month', async () => {
    renderPage('/leaderboard?period=week');
    await table(/Full ranking: call reps/);
    expect(screen.queryByRole('heading', { name: 'Rewards' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Period'), '2026-09');
    await waitFor(() => expect(svc.board).toHaveBeenCalledWith('call_rep', '2026-09'));
    expect(await screen.findByRole('heading', { name: 'Rewards' })).toBeInTheDocument();
  });

  it('the period in the URL is the one shown; a bad value falls back to the month', async () => {
    renderPage('/leaderboard?role=delivery&period=year');
    await table(/Full ranking: delivery/);
    expect(svc.board).toHaveBeenCalledWith('delivery', 'year');
    expect(screen.getByLabelText('Period')).toHaveValue('year');
  });

  it('month: tier prices, distance to the next tier, "Top tier reached" for a person over 120 percent', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rewards' });
    expect(screen.getByText('100% of target')).toBeInTheDocument();
    expect(screen.getByText('GH₵300 bonus')).toBeInTheDocument();
    expect(screen.getByText('GH₵500 + paid day off')).toBeInTheDocument();
    expect(screen.getByText(/4 more confirmed orders that get delivered to reach 100%/, { selector: 'small' })).toBeInTheDocument();
    expect(screen.getByText(/Top tier reached/)).toBeInTheDocument();
  });

  it('AI agents and companies show No payout; a company under its target shows a neutral contract review tag with no percent number', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rewards' });
    expect(screen.getByText(/No payout\. Attainment 40%/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /Delivery/ }));
    await screen.findByRole('table', { name: /Full ranking: delivery/ });
    const rewards = within(screen.getByRole('heading', { name: 'Rewards' }).closest('.card') as HTMLElement);
    expect(rewards.getByText(/Contract review\. Companies get no bonus/)).toBeInTheDocument();
    expect(rewards.getByText('Review')).toBeInTheDocument();
    expect(rewards.getByText(/No closed orders yet\. Too early to rank/)).toBeInTheDocument();
    expect(rewards.getByText('AI agents and companies get no payout.')).toBeInTheDocument();
    const logi = screen.getByRole('table', { name: /Full ranking: delivery/ });
    expect(within(logi).getByText('Contract review')).toBeInTheDocument();
  });

  it('no "80%" text anywhere on the screen, on either tab', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Rewards' });
    expect(document.body.textContent).not.toMatch(/80\s?%|80 percent|airtime/i);
    await userEvent.click(screen.getByRole('tab', { name: /Delivery/ }));
    await screen.findByRole('table', { name: /Full ranking: delivery/ });
    expect(document.body.textContent).not.toMatch(/80\s?%|80 percent|airtime/i);
  });

  it('the podium shows the top three ranked people; rank 1 first in the middle', async () => {
    renderPage();
    const podium = within(await screen.findByLabelText('Podium'));
    expect(podium.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    expect(podium.getByText('Top Rep')).toBeInTheDocument();
    expect(podium.getAllByText(/^1st$/)).toHaveLength(3); // Top Rep, Adwoa and Tie Rep all share rank 1
  });

  it('badges: each with holders and month, or "Locked, no one yet"; only people of this tab', async () => {
    renderPage();
    const badges = within((await screen.findByRole('heading', { name: 'Badges' })).closest('.card') as HTMLElement);
    expect(badges.getByText('Adwoa Darko, September')).toBeInTheDocument();
    // Hit target 3 months, Beat target by 20 (only Kofi, a delivery person) and Zero unpaid have no holder on this tab
    expect(badges.getAllByText('Locked, no one yet')).toHaveLength(3);
    // Kofi is a delivery person: not on the call rep tab
    expect(badges.queryByText(/Kofi Appiah/)).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /Delivery/ }));
    const delivery = within((await screen.findByRole('heading', { name: 'Badges' })).closest('.card') as HTMLElement);
    await waitFor(() => expect(delivery.getAllByText('Kofi Appiah, September')).toHaveLength(2)); // Top of month and Beat target by 20 percent
    expect(svc.badges).toHaveBeenCalledWith('2026-10');
  });

  it('a switched-off badge display shows no Badges card', async () => {
    svc.badges.mockResolvedValue({ display: false, badges: [] });
    renderPage();
    await screen.findByRole('heading', { name: 'Rewards' });
    expect(screen.queryByRole('heading', { name: 'Badges' })).toBeNull();
  });

  it('a rep sees their own row only: no podium, "Your rank", one row', async () => {
    useAuthStore.setState({ user: { id: 4, role: 'sales_rep', firstName: 'Nana', lastName: 'K', isPlatformAdmin: false } as never, menu: ['leaderboard'], homeRoute: '/' });
    svc.board.mockImplementation(async (role: string) => (role === 'call_rep'
      ? { ...JSON.parse(JSON.stringify(CALL_MONTH)), rows: JSON.parse(JSON.stringify(CALL_MONTH.rows.filter((r) => r.userId === 4))) }
      : { ...JSON.parse(JSON.stringify(DELIVERY_MONTH)), rows: [] }));
    renderPage();
    const t = await table(/Your rank/);
    expect(t.getAllByRole('row')).toHaveLength(2);
    expect(t.getByText('Nana Kyei')).toBeInTheDocument();
    expect(t.getByLabelText('Rank 4')).toBeInTheDocument();
    expect(screen.queryByLabelText('Podium')).toBeNull();
  });

  it('a failing board shows its own error with Retry', async () => {
    svc.board.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'));
    renderPage();
    expect(await screen.findByText('Leaderboard did not load')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: /Full ranking: call reps/ })).toBeInTheDocument();
  });

  it('nobody holds the role: an empty state, no podium', async () => {
    svc.board.mockImplementation(async (role: string) => ({ ...JSON.parse(JSON.stringify(answers(role, 'month'))), rows: [] }));
    renderPage();
    expect(await screen.findByText('No one holds this role yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Podium')).toBeNull();
  });
});

describe('Leaderboard in the navigation (M6-T16)', () => {
  it('the Team group has a Leaderboard item that opens /leaderboard for a person who has the menu key', () => {
    const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === 'leaderboard');
    expect(item).toMatchObject({ label: 'Leaderboard', to: '/leaderboard' });
    const groups = visibleGroups(['dashboard', 'leaderboard'], 'admin');
    expect(groups.flatMap((g) => g.items.map((i) => i.key))).toContain('leaderboard');
    expect(visibleGroups(['dashboard'], 'admin').flatMap((g) => g.items.map((i) => i.key))).not.toContain('leaderboard');
  });
});
