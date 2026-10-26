import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { CashFlowPanel } from '../../pages/financial/cash/CashFlowPanel';
import { ExportMenu } from '../../pages/financial/cash/ExportMenu';
import { useConfigStore } from '../../stores/configStore';
import { useFinancialStore } from '../../stores/financialStore';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { cashFlow, trend } from '../fixtures/financeProfit';

const svc = { cashFlow: vi.fn(), trend: vi.fn(), exportFile: vi.fn() };
vi.mock('../../services/financeReports.service', () => ({
  financeReportsService: {
    cashFlow: (...a: unknown[]) => svc.cashFlow(...a), trend: (...a: unknown[]) => svc.trend(...a), exportFile: (...a: unknown[]) => svc.exportFile(...a),
  },
}));
const saveBlob = vi.fn();
vi.mock('../../utils/downloadBlob', () => ({ downloadBlob: (...a: unknown[]) => saveBlob(...a) }));
vi.mock('../../pages/orders/importText', () => ({ apiMessage: async (_e: unknown, fallback: string) => fallback }));

const open = (ui: JSX.Element) => render(<ToastProvider><MemoryRouter>{ui}</MemoryRouter></ToastProvider>);
const tile = (label: string) => screen.getByText(label).closest('.kpi') as HTMLElement;
const dayGap = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

beforeEach(() => {
  clearBlockCache();
  Object.values(svc).forEach((m) => m.mockReset());
  saveBlob.mockReset();
  useConfigStore.setState({ currency: 'GHS' });
  useFinancialStore.setState({ dateRange: { startDate: '2026-10-01', endDate: '2026-10-17' } });
  svc.cashFlow.mockImplementation(async (scenario: 'pace' | 'target') => cashFlow(scenario));
  svc.trend.mockResolvedValue(trend());
  svc.exportFile.mockResolvedValue({ blob: new Blob(['x']), filename: 'cash-flow-forecast_2026-10-18_to_2026-10-18.csv' });
});

describe('Cash flow tab (M5-T41)', () => {
  it('keeps each unit of money in one bucket: 1010 and 1015 add to the cash total, expected is shown apart as expected', async () => {
    open(<CashFlowPanel />);
    await screen.findByText('Cash at bank and MoMo');
    expect(tile('Cash at bank and MoMo')).toHaveTextContent('GH₵41,900');
    expect(tile('Cash at bank and MoMo')).toHaveTextContent('Account 1010');
    expect(tile('Cash with delivery partners')).toHaveTextContent('GH₵23,400');
    expect(tile('Cash with delivery partners')).toHaveTextContent('Account 1015');
    // the total is the server's 1010 + 1015, not the pipeline that adds expected cash
    expect(tile('Cash in total')).toHaveTextContent('GH₵65,300');
    expect(tile('Cash in total')).not.toHaveTextContent('GH₵80,100');
    expect(tile('Expected, out for delivery')).toHaveTextContent('GH₵14,800');
    expect(tile('Expected, out for delivery')).toHaveTextContent('Not cash until delivered and paid');
    expect(within(tile('Expected, out for delivery')).getByText('Expected')).toBeInTheDocument();
  });

  it('starts at today\'s pace, and shows the 30 day tiles and the finding', async () => {
    open(<CashFlowPanel />);
    expect(await screen.findByText('Expected in, 30 days')).toBeInTheDocument();
    expect(svc.cashFlow).toHaveBeenCalledWith('pace');
    expect(screen.getByRole('button', { name: "Today's pace" })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'If delivery success reaches 60%' })).toHaveAttribute('aria-pressed', 'false');
    expect(tile('Expected in, 30 days')).toHaveTextContent('GH₵3,000');
    expect(tile('Expected out, 30 days')).toHaveTextContent('GH₵51,000');
    expect(tile('Cash on 16 Nov')).toHaveTextContent('-GH₵6,100');
    expect(tile('Cash on 16 Nov')).toHaveTextContent('Lowest -GH₵6,100 on 16 Nov');
    expect(within(tile('Cash on 16 Nov')).getByText('Runs out')).toBeInTheDocument();
    expect(screen.getByText("Cash runs out around 12 Nov at today's pace")).toBeInTheDocument();
    expect(screen.getByText('New deliveries are paid after 4.5 days on average, from partner payout history.')).toBeInTheDocument();
    expect(screen.getByText('Supplier payables of GH₵5,000 go out on the first day.')).toBeInTheDocument();
  });

  it('a tight low point says how many days of spending the server counts as tight', async () => {
    svc.cashFlow.mockResolvedValue({ ...cashFlow('pace'), summary: { ...cashFlow('pace').summary, status: 'tight', runsOutOn: null, tightDays: 5, lowest: { date: '2026-11-03', balance: '900.00' } } });
    open(<CashFlowPanel />);
    expect(await screen.findByText('Cash gets tight around 3 Nov')).toBeInTheDocument();
    expect(screen.getByText(/That is under 5 days of expected spending\./)).toBeInTheDocument();
  });

  it('the scenario switch asks the server for the target, and every figure and sentence follows its answer', async () => {
    open(<CashFlowPanel />);
    await screen.findByText('Expected in, 30 days');
    await userEvent.click(screen.getByRole('button', { name: 'If delivery success reaches 60%' }));
    await waitFor(() => expect(svc.cashFlow).toHaveBeenLastCalledWith('target'));
    await waitFor(() => expect(tile('Expected in, 30 days')).toHaveTextContent('GH₵62,000'));
    expect(screen.getByRole('button', { name: 'If delivery success reaches 60%' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tile('Cash on 16 Nov')).getByText('Safe')).toBeInTheDocument();
    expect(screen.getByText('Cash stays above GH₵37,400 at 60% delivery success')).toBeInTheDocument();
    expect(screen.getByText('At the target, new deliveries bring in 1.25 times as much as today. Nothing else changes.')).toBeInTheDocument();
    // outflows do not change with the scenario, and the money buckets are the same
    expect(tile('Expected out, 30 days')).toHaveTextContent('GH₵51,000');
    expect(tile('Cash at bank and MoMo')).toHaveTextContent('GH₵41,900');
    await userEvent.click(screen.getByRole('button', { name: "Today's pace" }));
    // pace was answered a moment ago: the switch back reuses it and shows its figures without asking again
    await waitFor(() => expect(tile('Expected in, 30 days')).toHaveTextContent('GH₵3,000'));
    expect(svc.cashFlow).toHaveBeenCalledTimes(2);
  });

  it('lists the weeks, with a negative net and cash at the end as the server sent them', async () => {
    open(<CashFlowPanel />);
    const table = await screen.findByRole('table', { name: 'Week by week' });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('td')].map((c) => c.textContent));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual(['18 Oct to 24 Oct', 'GH₵700', '-GH₵11,900', '-GH₵11,200', 'GH₵30,700']);
    expect(rows[4]).toEqual(['15 Nov to 16 Nov', 'GH₵200', '-GH₵3,400', '-GH₵3,200', '-GH₵6,100']);
  });

  it('Export CSV downloads the forecast of the scenario on screen', async () => {
    open(<CashFlowPanel />);
    await screen.findByText('Expected in, 30 days');
    await userEvent.click(screen.getByRole('button', { name: 'If delivery success reaches 60%' }));
    await waitFor(() => expect(svc.cashFlow).toHaveBeenLastCalledWith('target'));
    await userEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(svc.exportFile).toHaveBeenCalledWith('cash-flow', { format: 'csv', scenario: 'target' }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'cash-flow-forecast_2026-10-18_to_2026-10-18.csv'));
    expect(await screen.findByText('Downloaded cash-flow-forecast_2026-10-18_to_2026-10-18.csv')).toBeInTheDocument();
  });

  it('a failed forecast shows its own error with Retry, and the trend card still works', async () => {
    svc.cashFlow.mockRejectedValueOnce(new Error('boom'));
    open(<CashFlowPanel />);
    expect(await screen.findByText('Cash flow did not load')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Delivered revenue and expenses/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Expected in, 30 days')).toBeInTheDocument();
  });
});

describe('Revenue and expenses trend (M5-T41, F-929)', () => {
  it('asks for the last 30 days, and the range select asks again for 7, 90 and 12 months', async () => {
    open(<CashFlowPanel />);
    await screen.findByRole('img', { name: /Delivered revenue and expenses/ });
    const [first] = svc.trend.mock.calls.at(-1)!;
    const last = svc.trend.mock.calls.at(-1)![1];
    expect(dayGap(first, last)).toBe(29);
    const select = screen.getByRole('combobox', { name: 'Range' });
    for (const [value, gap] of [['7', 6], ['90', 89], ['365', 364]] as const) {
      await userEvent.selectOptions(select, value);
      await waitFor(() => { const [f, t] = svc.trend.mock.calls.at(-1)!; expect(dayGap(f, t)).toBe(gap); });
    }
    expect(screen.getByText('Revenue and expenses per day')).toBeInTheDocument();
  });

  it('an empty range is an empty state, and the select stays so the range can be changed back', async () => {
    svc.trend.mockResolvedValue({ grouping: 'day', reports: [] });
    open(<CashFlowPanel />);
    expect(await screen.findByText('Nothing delivered or spent')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Range' })).toBeInTheDocument();
  });

  it('a range over 366 days is grouped by week and the title says so', async () => {
    svc.trend.mockResolvedValue({ grouping: 'week', reports: trend().reports });
    open(<CashFlowPanel />);
    expect(await screen.findByText('Revenue and expenses per week')).toBeInTheDocument();
  });
});

describe('Export menu (M5-T41, F-930)', () => {
  const menu = async () => {
    open(<ExportMenu />);
    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    return screen.getByRole('menu', { name: 'Export' });
  };

  it('lists the four files and Excel for profit and loss, and a link to Reports', async () => {
    const m = await menu();
    expect(within(m).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'Profit and lossCSV', 'Agent aging and collectionsCSV', 'General ledgerCSV',
      'Cash-flow forecastCSV', 'Profit and lossExcel', 'More in ReportsCSV and Excel, any dates',
    ]);
    expect(within(m).getByRole('menuitem', { name: /More in Reports/ })).toHaveAttribute('href', '/reports?tab=products');
  });

  it('each item downloads a real file; profit and loss and the ledger take the Finance dates, the others do not', async () => {
    const m = await menu();
    await userEvent.click(within(m).getByRole('menuitem', { name: /Profit and loss CSV|Profit and lossCSV/ }));
    await waitFor(() => expect(svc.exportFile).toHaveBeenLastCalledWith('profit-loss', { format: 'csv', startDate: '2026-10-01', endDate: '2026-10-17' }, expect.anything()));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'cash-flow-forecast_2026-10-18_to_2026-10-18.csv');

    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Agent aging and collections/ }));
    await waitFor(() => expect(svc.exportFile).toHaveBeenLastCalledWith('agent-aging', { format: 'csv', startDate: undefined, endDate: undefined }, expect.anything()));

    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /General ledger/ }));
    await waitFor(() => expect(svc.exportFile).toHaveBeenLastCalledWith('general-ledger', { format: 'csv', startDate: '2026-10-01', endDate: '2026-10-17' }, expect.anything()));

    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Cash-flow forecast/ }));
    await waitFor(() => expect(svc.exportFile).toHaveBeenLastCalledWith('cash-flow', { format: 'csv', startDate: undefined, endDate: undefined }, expect.anything()));

    await userEvent.click(screen.getByRole('button', { name: /Export/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Profit and loss ?Excel/ }));
    await waitFor(() => expect(svc.exportFile).toHaveBeenLastCalledWith('profit-loss', { format: 'xlsx', startDate: '2026-10-01', endDate: '2026-10-17' }, expect.anything()));
    expect(svc.exportFile).toHaveBeenCalledTimes(5);
  });

  it('a failed export says so and does not save a file', async () => {
    svc.exportFile.mockRejectedValueOnce(new Error('nope'));
    const m = await menu();
    await userEvent.click(within(m).getByRole('menuitem', { name: /Profit and loss CSV|Profit and lossCSV/ }));
    expect(await screen.findByText('The file could not be exported. Try again.')).toBeInTheDocument();
    expect(saveBlob).not.toHaveBeenCalled();
  });

  it('Escape closes the menu', async () => {
    await menu();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
