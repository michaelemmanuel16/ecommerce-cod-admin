import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CurrenciesFxPanel } from '../../components/settings/CurrenciesFxPanel';
import { fxService, FxRatesResponse } from '../../services/fx.service';
import { analyticsService } from '../../services/analytics.service';
import { adminService } from '../../services/admin.service';
import { isStaleManualRate } from '../../utils/fx';

vi.mock('../../services/fx.service', () => ({
  fxService: {
    getRates: vi.fn(),
    getHistory: vi.fn(),
    saveManualRate: vi.fn(),
    useToday: vi.fn(),
  },
}));
vi.mock('../../services/analytics.service', () => ({ analyticsService: { getMonthRevenue: vi.fn() } }));
vi.mock('../../services/admin.service', () => ({ adminService: { updateSystemConfig: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const TODAY = '2026-10-20';
const provider = { name: 'ExchangeRate-API', url: 'https://www.exchangerate-api.com' };

const ratesWith = (rates: FxRatesResponse['rates']): FxRatesResponse => ({ storeCurrency: 'GHS', today: TODAY, rates, provider });
const rate = (to: string, source: 'auto' | 'manual', date: string, value = 112) =>
  ({ from: 'GHS', to, rate: value, date, source, exact: true });

beforeEach(() => {
  vi.clearAllMocks();
  (fxService.getHistory as any).mockResolvedValue([]);
  (analyticsService.getMonthRevenue as any).mockResolvedValue({ value: 92000, currency: 'GHS' });
  (fxService.saveManualRate as any).mockResolvedValue(undefined);
  (adminService.updateSystemConfig as any).mockResolvedValue({});
});

describe('isStaleManualRate', () => {
  it('is true only for a manual rate older than 7 days', () => {
    expect(isStaleManualRate({ source: 'manual', date: '2026-10-12' }, TODAY)).toBe(true);
    expect(isStaleManualRate({ source: 'manual', date: '2026-10-13' }, TODAY)).toBe(false); // exactly 7 days
    expect(isStaleManualRate({ source: 'auto', date: '2026-01-01' }, TODAY)).toBe(false);
  });
});

describe('CurrenciesFxPanel', () => {
  it('shows the stale warning for a manual rate older than 7 days and not for an automatic one', async () => {
    (fxService.getRates as any).mockResolvedValue(ratesWith([
      rate('NGN', 'manual', '2026-10-01'),
      rate('USD', 'auto', '2026-09-01', 0.08),
      rate('KES', 'manual', '2026-10-19', 12),
    ]));
    render(<CurrenciesFxPanel />);
    await screen.findByTestId('row-NGN');
    expect(screen.getByTestId('stale-warning-NGN')).toBeTruthy();
    expect(screen.queryByTestId('stale-warning-USD')).toBeNull();
    expect(screen.queryByTestId('stale-warning-KES')).toBeNull();
    expect(screen.getByTestId('source-NGN').textContent).toBe('Manual');
    expect(screen.getByTestId('source-USD').textContent).toBe('Automatic');
  });

  it('shows the tiles and the sample rate', async () => {
    (fxService.getRates as any).mockResolvedValue(ratesWith([rate('NGN', 'auto', TODAY)]));
    render(<CurrenciesFxPanel />);
    await screen.findByTestId('row-NGN');
    expect(await screen.findByText('GH₵92,000')).toBeTruthy();
    expect(screen.getByTestId('tile-sample-rate').textContent).toContain('1 GH₵ = ₦112');
  });

  it('shows the currency-change note only after the store currency is changed', async () => {
    (fxService.getRates as any).mockResolvedValue(ratesWith([rate('NGN', 'auto', TODAY)]));
    render(<CurrenciesFxPanel />);
    await screen.findByTestId('row-NGN');
    expect(screen.queryByTestId('currency-change-note')).toBeNull();
    fireEvent.change(screen.getByLabelText('Store currency'), { target: { value: 'NGN' } });
    expect(screen.getByTestId('currency-change-note').textContent).toMatch(/keep the currency they were entered in/);
  });

  it('Save sends the manual rate and the new store currency, then reloads', async () => {
    (fxService.getRates as any).mockResolvedValue(ratesWith([rate('NGN', 'auto', TODAY)]));
    render(<CurrenciesFxPanel />);
    await screen.findByTestId('row-NGN');
    fireEvent.change(screen.getByLabelText('Manual rate for NGN'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Store currency'), { target: { value: 'KES' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(fxService.saveManualRate).toHaveBeenCalledWith('NGN', 150));
    await waitFor(() => expect(adminService.updateSystemConfig).toHaveBeenCalledWith({ currency: 'KES' }));
    await waitFor(() => expect((fxService.getRates as any).mock.calls.length).toBeGreaterThan(1));
  });

  it("Use today's rate calls the API for that currency", async () => {
    (fxService.getRates as any).mockResolvedValue(ratesWith([rate('NGN', 'manual', '2026-10-01')]));
    render(<CurrenciesFxPanel />);
    await screen.findByTestId('row-NGN');
    (fxService.useToday as any).mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: /Use today/ }));
    await waitFor(() => expect(fxService.useToday).toHaveBeenCalledWith('NGN'));
  });
});
