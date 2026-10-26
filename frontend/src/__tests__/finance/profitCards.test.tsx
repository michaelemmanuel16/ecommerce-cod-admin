import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverviewProfitCards } from '../../pages/financial/profit/OverviewProfitCards';
import { ProductProfitPanel } from '../../pages/financial/profit/ProductProfitPanel';
import { StatementsPanel } from '../../pages/financial/profit/StatementsPanel';
import { clearBlockCache } from '../../pages/financial/profit/useBlock';
import { useConfigStore } from '../../stores/configStore';
import { useFinancialStore } from '../../stores/financialStore';
import {
  AUG_SEP_NOTE, balanceSheet, cohortProfit, failedCost, incomeStatement, monthlyPl, profitByProduct,
} from '../fixtures/financeProfit';

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

const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent);
/** The body row whose first cell starts with `label`. */
const rowOf = (table: HTMLElement, label: string) => {
  const row = [...table.querySelectorAll('tr')].find((r) => r.cells[0]?.textContent?.startsWith(label));
  if (!row) throw new Error(`No row starts with "${label}"`);
  return row as HTMLElement;
};

beforeEach(() => {
  clearBlockCache();
  Object.values(svc).forEach((m) => m.mockReset());
  useConfigStore.setState({ currency: 'GHS' });
  useFinancialStore.setState({ dateRange: { startDate: '2026-10-01', endDate: '2026-10-17' } });
  svc.monthlyPl.mockResolvedValue(monthlyPl());
  svc.incomeStatement.mockResolvedValue(incomeStatement());
  svc.balanceSheet.mockResolvedValue(balanceSheet());
  svc.profitByProduct.mockResolvedValue(profitByProduct());
  svc.cohortProfit.mockResolvedValue(cohortProfit());
  svc.failedDeliveryCost.mockResolvedValue(failedCost());
});

describe('Finance Overview profit cards (M5-T40)', () => {
  it('asks for the Finance date range', async () => {
    render(<OverviewProfitCards />);
    await screen.findByRole('table', { name: 'Monthly profit and loss' });
    expect(svc.cohortProfit).toHaveBeenCalledWith('2026-10-01', '2026-10-17');
    expect(svc.failedDeliveryCost).toHaveBeenCalledWith('2026-10-01', '2026-10-17');
    expect(svc.profitByProduct).not.toHaveBeenCalled(); // the cohort answer carries the by-delivery-date number itself
  });

  it('monthly P&L shows the fixture columns, the August and September note, and commission as "Not split out"', async () => {
    render(<OverviewProfitCards />);
    const table = await screen.findByRole('table', { name: 'Monthly profit and loss' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Line', 'AugAs booked', 'SepAs booked', '1-17 Sep', '1-17 Oct']);
    expect(cells(rowOf(table, 'Delivered revenue'))).toEqual(['Delivered revenue', 'GH₵166,000', 'GH₵173,000', 'GH₵96,000', 'GH₵92,000']);
    expect(cells(rowOf(table, 'Rep commission'))).toEqual(['Rep commission and rewards', 'Not split out', 'Not split out', 'Not split out', 'GH₵2,768']);
    expect(cells(rowOf(table, 'Net profit'))).toEqual(['Net profit', 'GH₵20,700', 'GH₵21,300', 'GH₵11,800', '-GH₵14,268']);
    expect(cells(rowOf(table, 'Net margin'))[4]).toBe('-16%');
    expect(cells(rowOf(table, 'Meta ad spend'))[4]).toBe('GH₵76,200₦112 = GH₵1');
    // the note is on screen, per month, as the server sent it
    expect(screen.getAllByText(`Aug: ${AUG_SEP_NOTE}`)).toHaveLength(1);
    expect(screen.getByText(`Sep: ${AUG_SEP_NOTE}`)).toBeInTheDocument();
    expect(screen.getByText(/Aug, Sep and 1-17 Sep stay as booked/)).toBeInTheDocument();
  });

  it('the cohort card shows the projected October with its yield, and the one-line summary of both readings', async () => {
    render(<OverviewProfitCards />);
    const table = await screen.findByRole('table', { name: 'October order cohort' });
    expect(cells(rowOf(table, 'Delivered orders'))[1]).toBe('491');
    expect(cells(rowOf(table, 'Revenue'))[1]).toBe('GH₵120,300');
    expect(cells(rowOf(table, 'Product cost'))[1]).toBe('-GH₵14,700');
    expect(cells(rowOf(table, 'Delivery fees'))[1]).toBe('-GH₵15,900');
    expect(cells(rowOf(table, 'Meta ad spend'))[1]).toBe('-GH₵76,200');
    expect(cells(rowOf(table, 'Rep commission'))[1]).toBe('-GH₵3,600');
    expect(cells(rowOf(table, 'Profit before other expenses'))[1]).toBe('GH₵9,900');
    expect(screen.getByText(/projected at 34% yield/)).toBeInTheDocument();
    expect(await screen.findByText('By delivery date: -GH₵14,268. By order cohort: GH₵9,900.')).toBeInTheDocument();
  });

  it('with no closed cohort the card says "Not enough closed orders" and shows no figure', async () => {
    svc.cohortProfit.mockResolvedValue({ from: '2026-10-01', to: '2026-10-17', available: false, message: 'Not enough closed orders' });
    render(<OverviewProfitCards />);
    expect(await screen.findByText(/Not enough closed orders\./)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'October order cohort' })).not.toBeInTheDocument();
  });

  it('the failed delivery card adds up to GH₵610 = 460 + 150 and says when a partner has no fee rule', async () => {
    render(<OverviewProfitCards />);
    const table = await screen.findByRole('table', { name: 'Cost of failed deliveries' });
    expect(cells(rowOf(table, 'Kofi Appiah'))).toEqual(['Kofi Appiah70 failed or returned', 'GH₵350', '0GH₵0', 'GH₵350']);
    expect(cells(rowOf(table, 'Logiswift'))[2]).toBe('5GH₵150');
    expect(cells(rowOf(table, 'Total'))).toEqual(['Total', 'GH₵460', '5GH₵150', 'GH₵610']);
    expect(screen.getByText('No fee rule for this partner. The failed fee is 0.')).toBeInTheDocument();
  });

  it('a card that fails shows its own error with Retry while the others stay', async () => {
    svc.failedDeliveryCost.mockRejectedValueOnce(new Error('boom'));
    render(<OverviewProfitCards />);
    expect(await screen.findByText('Cost of failed deliveries did not load')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Monthly profit and loss' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Cost of failed deliveries' })).toBeInTheDocument();
  });
});

describe('Finance statements (M5-T40)', () => {
  it('shows the income statement, the balance sheet with 3010 and the result to date, and the monthly P&L', async () => {
    render(<StatementsPanel />);
    const income = await screen.findByRole('table', { name: 'Income statement' });
    expect(cells(rowOf(income, 'Delivered revenue'))[1]).toBe('GH₵92,000');
    expect(cells(rowOf(income, 'Gross profit'))).toEqual(['Gross profit 87% margin', 'GH₵80,000']);
    expect(cells(rowOf(income, 'Net result'))).toEqual(['Net result -16% margin', '-GH₵14,268']);
    const sheet = await screen.findByRole('table', { name: 'Balance sheet' });
    expect(cells(rowOf(sheet, 'Cash at bank and MoMo'))[1]).toBe('GH₵41,900');
    expect(cells(rowOf(sheet, "Owner's equity"))[1]).toBe('GH₵109,200');
    expect(cells(rowOf(sheet, 'Result to date'))[1]).toBe('-GH₵14,268');
    expect(cells(rowOf(sheet, 'Total assets'))[1]).toBe('GH₵106,900');
    expect(cells(rowOf(sheet, 'Liabilities and equity'))[1]).toBe('GH₵106,900');
    expect(await screen.findByRole('table', { name: 'Monthly profit and loss' })).toBeInTheDocument();
    expect(svc.incomeStatement).toHaveBeenCalledWith('2026-10-01', '2026-10-17');
    expect(svc.balanceSheet).toHaveBeenCalledWith('2026-10-17'); // as at the end of the range
  });

  it('an out of balance sheet says by how much', async () => {
    svc.balanceSheet.mockResolvedValue({ ...balanceSheet(), isBalanced: false, outOfBalanceBy: '120.00' });
    render(<StatementsPanel />);
    expect(await screen.findByText(/by GH₵120\./)).toBeInTheDocument();
  });

  it('Export PDF opens the print dialog, as the old statements tab did', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<StatementsPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });
});

describe('Finance profit by product (M5-T40)', () => {
  it('shows each product row, "Cost missing", the lines not split by product, and the net result', async () => {
    render(<ProductProfitPanel />);
    const table = await screen.findByRole('table', { name: 'Profit by product' });
    expect(cells(rowOf(table, 'Magic Groove copybook set'))).toEqual(['Magic Groove copybook set', '376', 'GH₵92,000', 'GH₵12,000', 'GH₵12,200', 'GH₵0', 'GH₵67,800', '74%']);
    expect(cells(rowOf(table, 'Refill pens'))).toEqual(['Refill pens', '12', 'GH₵480', 'Cost missing', 'GH₵0', 'GH₵0', '-', 'n/a']);
    expect(cells(rowOf(table, 'Meta spend with no product'))[6]).toBe('-GH₵76,200');
    expect(cells(rowOf(table, 'Rep commission'))[6]).toBe('-GH₵2,768');
    expect(cells(rowOf(table, 'Other expenses'))[6]).toBe('-GH₵3,100');
    expect(cells(rowOf(table, 'Net result'))).toEqual(['Net result', '376', 'GH₵92,000', 'GH₵12,000', 'GH₵12,200', 'GH₵76,200', '-GH₵14,268', '-16%']);
    expect(screen.getByText(/1 product has no cost yet/)).toBeInTheDocument();
  });

  it('the finding above the table is written from the rows', async () => {
    render(<ProductProfitPanel />);
    expect(await screen.findByText('October ends with a loss of GH₵14,268')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Meta spend of GH₵76,200'));
  });

  it('an empty range says nothing was delivered, with no NaN', async () => {
    svc.profitByProduct.mockResolvedValue({ ...profitByProduct(), products: [], totals: { delivered: 0, revenue: '0.00', productCost: '0.00', fees: '0.00', metaAds: '0.00' }, netProfit: '0.00', netMarginPct: null, profitPerDeliveredOrder: null, metaSpendWithNoProduct: '0.00', repCommission: '0.00', otherExpenses: '0.00', costMissingProducts: 0 });
    render(<ProductProfitPanel />);
    expect(await screen.findByText('No order was delivered in these dates.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});
