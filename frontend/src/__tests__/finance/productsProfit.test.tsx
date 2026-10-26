/**
 * M5-T44 (F-1055): Reports, "Products and profit". It reuses the Finance cards, so for the same range it must show the same
 * numbers. The contract test renders both screens on one mocked API and compares what they print.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/ui-v2';
import { Reports } from '../../pages/Reports';
import { OverviewProfitCards } from '../../pages/financial/profit/OverviewProfitCards';
import { ProductProfitPanel } from '../../pages/financial/profit/ProductProfitPanel';
import { StatementsPanel } from '../../pages/financial/profit/StatementsPanel';
import { ProductsTab } from '../../pages/reports/ProductsTab';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { useFinancialStore } from '../../stores/financialStore';
import { reportsFixture, withoutCompare } from '../fixtures/reports';
import { balanceSheet, cohortProfit, failedCost, incomeStatement, monthlyPl, profitByProduct } from '../fixtures/financeProfit';

const svc = {
  monthlyPl: vi.fn(), incomeStatement: vi.fn(), balanceSheet: vi.fn(), profitByProduct: vi.fn(), cohortProfit: vi.fn(), failedDeliveryCost: vi.fn(),
};
vi.mock('../../services/financeReports.service', () => ({
  financeReportsService: {
    monthlyPl: (...a: unknown[]) => svc.monthlyPl(...a), incomeStatement: (...a: unknown[]) => svc.incomeStatement(...a),
    balanceSheet: (...a: unknown[]) => svc.balanceSheet(...a), profitByProduct: (...a: unknown[]) => svc.profitByProduct(...a),
    cohortProfit: (...a: unknown[]) => svc.cohortProfit(...a), failedDeliveryCost: (...a: unknown[]) => svc.failedDeliveryCost(...a),
  },
}));
const get = vi.fn();
vi.mock('../../services/reports.service', () => ({ reportsService: { get: (...a: unknown[]) => get(...a), download: vi.fn() } }));

const RANGE = { from: '2026-10-01', to: '2026-10-17' };
const tableText = (name: string) => {
  const t = screen.getByRole('table', { name });
  return [...t.querySelectorAll('tr')].map((r) => [...r.querySelectorAll('th,td')].map((c) => c.textContent));
};
const tile = (label: string) => screen.getByText(label).closest('.kpi') as HTMLElement;

beforeEach(() => {
  Object.values(svc).forEach((m) => m.mockReset());
  get.mockReset();
  useConfigStore.setState({ currency: 'GHS', loaded: true });
  useFinancialStore.setState({ dateRange: { startDate: RANGE.from, endDate: RANGE.to } });
  svc.monthlyPl.mockResolvedValue(monthlyPl());
  svc.incomeStatement.mockResolvedValue(incomeStatement());
  svc.balanceSheet.mockResolvedValue(balanceSheet());
  svc.profitByProduct.mockResolvedValue(profitByProduct());
  svc.cohortProfit.mockResolvedValue(cohortProfit());
  svc.failedDeliveryCost.mockResolvedValue(failedCost());
});

describe('Reports, Products and profit (M5-T44)', () => {
  it('has the net result, profit by product and two ways to read October', async () => {
    render(<ProductsTab range={RANGE} />);
    expect(await screen.findByText('Net result, by delivery date')).toBeInTheDocument();
    expect(tile('Net result, by delivery date')).toHaveTextContent('-GH₵14,268');
    expect(tile('Net result, by delivery date')).toHaveTextContent('Net margin -16%');
    expect(tile('Delivered revenue')).toHaveTextContent('GH₵92,000');
    expect(tile('Meta ad spend')).toHaveTextContent('GH₵76,200');
    expect(tile('Profit per delivered order')).toHaveTextContent('-GH₵37.95');
    expect(tile('Profit per delivered order')).toHaveTextContent('Magic Groove copybook set GH₵180.32 before ads');

    expect(await screen.findByText('Two ways to read October')).toBeInTheDocument();
    expect(screen.getByText('By delivery date, what has landed so far')).toBeInTheDocument();
    expect(screen.getByText('-GH₵14,268 (-16%)')).toBeInTheDocument();
    expect(screen.getByText('By order cohort, projected at 34% yield')).toBeInTheDocument();
    expect(screen.getByText('GH₵9,900 (8%)')).toBeInTheDocument();

    const table = tableText('Profit by product');
    expect(table.at(-1)).toEqual(['Net result', '376', 'GH₵92,000', 'GH₵12,000', 'GH₵12,200', 'GH₵76,200', '-GH₵14,268', '-16%']);
  });

  it('asks only for the profit figures of the range it is given (nothing else of Finance)', async () => {
    render(<ProductsTab range={RANGE} />);
    await screen.findByText('Two ways to read October');
    expect(svc.profitByProduct).toHaveBeenCalledWith(RANGE.from, RANGE.to);
    expect(svc.cohortProfit).toHaveBeenCalledWith(RANGE.from, RANGE.to);
    expect(svc.monthlyPl).not.toHaveBeenCalled();
    expect(svc.failedDeliveryCost).not.toHaveBeenCalled();
  });

  it('with no closed cohort the second reading says "Not enough closed orders"', async () => {
    svc.cohortProfit.mockResolvedValue({ from: RANGE.from, to: RANGE.to, available: false, message: 'Not enough closed orders' });
    render(<ProductsTab range={RANGE} />);
    expect(await screen.findByText('Two ways to read October')).toBeInTheDocument();
    expect(screen.getByText('Not enough closed orders')).toBeInTheDocument();
  });

  it('a failed profit call shows one error with Retry in the tiles and the table, not a blank page', async () => {
    svc.profitByProduct.mockRejectedValue(new Error('boom'));
    render(<ProductsTab range={RANGE} />);
    expect(await screen.findByText('Profit figures did not load')).toBeInTheDocument();
    expect(screen.getByText('Profit by product did not load')).toBeInTheDocument();
  });
});

describe('contract: Reports and Finance print the same numbers for the same range (M5-T44)', () => {
  it('profit by product: the table is cell for cell the same', async () => {
    const finance = render(<ProductProfitPanel />);
    await screen.findByRole('table', { name: 'Profit by product' });
    const onFinance = tableText('Profit by product');
    finance.unmount();

    render(<ProductsTab range={RANGE} />);
    await screen.findByRole('table', { name: 'Profit by product' });
    expect(tableText('Profit by product')).toEqual(onFinance);
    expect(onFinance.length).toBeGreaterThan(5);
  });

  it('both screens ask the API for the same range', async () => {
    const finance = render(<ProductProfitPanel />);
    await screen.findByRole('table', { name: 'Profit by product' });
    const onFinance = svc.profitByProduct.mock.calls.at(-1);
    finance.unmount();
    svc.profitByProduct.mockClear();
    render(<ProductsTab range={RANGE} />);
    await screen.findByRole('table', { name: 'Profit by product' });
    expect(svc.profitByProduct.mock.calls.at(-1)).toEqual(onFinance);
  });

  it('the net result, the cohort figure and the income statement agree across the two screens', async () => {
    const finance = render(<><OverviewProfitCards /><StatementsPanel /></>);
    expect(await screen.findByText('By delivery date: -GH₵14,268. By order cohort: GH₵9,900.')).toBeInTheDocument();
    const income = await screen.findByRole('table', { name: 'Income statement' });
    const netOnFinance = within(income).getByText(/^Net result/).closest('tr')!.querySelectorAll('td')[1].textContent;
    expect(netOnFinance).toBe('-GH₵14,268');
    finance.unmount();

    render(<ProductsTab range={RANGE} />);
    expect(await screen.findByText('Two ways to read October')).toBeInTheDocument();
    expect(tile('Net result, by delivery date')).toHaveTextContent(netOnFinance!);
    expect(screen.getByText(/^-GH₵14,268 \(/)).toBeInTheDocument();
    expect(screen.getByText(/^GH₵9,900 \(/)).toBeInTheDocument();
  });
});

describe('Reports page opens the tab (M5-T44)', () => {
  const asRole = (role: string, permissions: Record<string, string[]>) =>
    useAuthStore.setState({ user: { id: 1, role, firstName: 'Manny', lastName: 'A', isPlatformAdmin: false } as never, permissions, menu: ['reports'], homeRoute: '/' });

  beforeEach(() => {
    get.mockImplementation((tab: 'overview' | 'sales' | 'delivery' | 'team') => Promise.resolve(withoutCompare(reportsFixture[tab]())));
  });

  it('?tab=products shows the Finance cards for the range on the date card', async () => {
    asRole('admin', { analytics: ['view', 'export'], financial: ['view'] });
    render(<ToastProvider><MemoryRouter initialEntries={['/reports?tab=products']}><Reports /></MemoryRouter></ToastProvider>);
    expect(await screen.findByRole('table', { name: 'Profit by product' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Products & profit', selected: true })).toBeInTheDocument();
    const [from, to] = svc.profitByProduct.mock.calls.at(-1)!;
    expect(from).toMatch(/^\d{4}-\d{2}-01$/); // "This month" starts on the 1st
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('without financial:view the tab is not offered and ?tab=products falls back to Overview', async () => {
    asRole('admin', { analytics: ['view'] });
    render(<ToastProvider><MemoryRouter initialEntries={['/reports?tab=products']}><Reports /></MemoryRouter></ToastProvider>);
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Products & profit' })).not.toBeInTheDocument();
    expect(svc.profitByProduct).not.toHaveBeenCalled();
  });
});
