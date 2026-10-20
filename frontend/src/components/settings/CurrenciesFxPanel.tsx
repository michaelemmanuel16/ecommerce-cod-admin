import React, { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { adminService } from '../../services/admin.service';
import { analyticsService } from '../../services/analytics.service';
import { fxService, FxCurrentRate, FxHistoryRow, FxRatesResponse } from '../../services/fx.service';
import { SUPPORTED_CURRENCIES, getCurrencyOptionLabel } from '../../utils/countries';
import { formatCurrency } from '../../utils/format';
import { STALE_MANUAL_DAYS, formatRateHelper, formatSampleRate, isStaleManualRate } from '../../utils/fx';

interface Props {
  /** Called after the store currency was saved, so the rest of the app reloads its config. */
  onStoreCurrencySaved?: () => void;
}

const inputClass = 'px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500';

/**
 * Settings, Currencies and FX tab (M1-T32). Plain styling; M3 restyles it.
 * Tiles: revenue in the store currency and a sample rate. The ad spend tile is left out: the app stores no ad
 * account currency yet, so there is nothing to show.
 */
export const CurrenciesFxPanel: React.FC<Props> = ({ onStoreCurrencySaved }) => {
  const [data, setData] = useState<FxRatesResponse | null>(null);
  const [history, setHistory] = useState<FxHistoryRow[]>([]);
  const [revenue, setRevenue] = useState<{ value: number; currency: string } | null>(null);
  /** Store currency picked in the select and not saved yet. Null: show the saved one. */
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  /** Manual rate typed in a row, by currency. Saved with the Save button. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newCurrency, setNewCurrency] = useState('');
  const [newRate, setNewRate] = useState('');
  const [saving, setSaving] = useState(false);

  const loadRates = useCallback(async () => {
    try {
      const [rates, rows] = await Promise.all([fxService.getRates(), fxService.getHistory()]);
      setData(rates);
      setHistory(rows);
      setDrafts({});
    } catch (error) {
      console.error('Failed to load FX rates:', error);
      toast.error('Failed to load currencies');
    }
  }, []);

  // Revenue is a side tile: a failure leaves it out.
  const loadRevenue = useCallback(() => {
    analyticsService.getMonthRevenue().then(setRevenue).catch(() => setRevenue(null));
  }, []);

  useEffect(() => { loadRates(); loadRevenue(); }, [loadRates, loadRevenue]);

  if (!data) return <Card><div className="p-6 text-sm text-gray-500">Loading currencies...</div></Card>;

  const storeCurrency = currencyOverride ?? data.storeCurrency;
  const currencyChanged = storeCurrency !== data.storeCurrency;
  const sample: FxCurrentRate | undefined = data.rates.find((r) => r.rate !== null);
  const usedCurrencies = new Set([data.storeCurrency, ...data.rates.map((r) => r.to)]);
  const addable = SUPPORTED_CURRENCIES.filter((c) => !usedCurrencies.has(c));

  const handleUseToday = async (to: string) => {
    try {
      await fxService.useToday(to);
      toast.success(`${to} is back on the daily automatic rate`);
      await loadRates();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Could not get today's rate");
    }
  };

  const handleAdd = async () => {
    const rate = Number(newRate);
    if (!newCurrency || !(rate > 0)) {
      toast.error('Pick a currency and enter a rate above 0');
      return;
    }
    try {
      await fxService.saveManualRate(newCurrency, rate);
      setNewCurrency('');
      setNewRate('');
      await loadRates();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || 'Failed to add the currency');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const entries = Object.entries(drafts).filter(([, text]) => text.trim() !== '');
      const rates = entries.map(([to, text]) => {
        const rate = Number(text);
        if (!(rate > 0)) throw new Error(`The ${to} rate must be above 0`);
        return { to, rate };
      });
      await Promise.all(rates.map(({ to, rate }) => fxService.saveManualRate(to, rate)));
      if (currencyChanged) {
        await adminService.updateSystemConfig({ currency: storeCurrency });
        onStoreCurrencySaved?.();
      }
      toast.success('Currency settings saved');
      setCurrencyOverride(null);
      await loadRates();
      if (currencyChanged) loadRevenue();
    } catch (error: any) {
      toast.error(error?.response?.data?.error || error?.message || 'Failed to save currency settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="p-4" data-testid="tile-revenue">
            <div className="text-sm text-gray-500">Revenue this month, in {data.storeCurrency}</div>
            <div className="text-2xl font-semibold text-gray-900">
              {revenue ? formatCurrency(revenue.value, revenue.currency) : '-'}
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4" data-testid="tile-sample-rate">
            <div className="text-sm text-gray-500">Sample rate</div>
            <div className="text-2xl font-semibold text-gray-900">
              {sample && sample.rate !== null ? formatSampleRate(sample.from, sample.to, sample.rate) : 'No rate yet'}
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-6 space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">Store currency</h3>
          <select
            aria-label="Store currency"
            value={storeCurrency}
            onChange={(e) => setCurrencyOverride(e.target.value)}
            className={`${inputClass} w-full md:w-1/2`}
          >
            {!SUPPORTED_CURRENCIES.includes(storeCurrency as any) && <option value={storeCurrency}>{storeCurrency}</option>}
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>{getCurrencyOptionLabel(c)}</option>
            ))}
          </select>
          <p className="text-sm text-gray-500">All figures show in the store currency. You can change it at any time.</p>
          {currencyChanged && (
            <p data-testid="currency-change-note" className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Old orders keep the currency they were entered in. Nothing is rewritten. Reports convert each record
              at the rate of its own date, so every past day needs a rate; a missing day uses the nearest earlier rate.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <div className="p-6 space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">Extra currencies</h3>
          {data.rates.length === 0 && <p className="text-sm text-gray-500">No extra currency in use. Add one below.</p>}
          {data.rates.map((r) => {
            const stale = isStaleManualRate(r, data.today);
            const draft = drafts[r.to] ?? '';
            const shown = draft !== '' && Number(draft) > 0 ? Number(draft) : r.rate;
            return (
              <div key={r.to} className="border border-gray-200 rounded-lg p-4 space-y-2" data-testid={`row-${r.to}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-gray-900">{r.to}</span>
                  <span>{r.rate !== null ? formatSampleRate(r.from, r.to, r.rate) : 'No rate yet'}</span>
                  <span
                    data-testid={`source-${r.to}`}
                    className={`text-xs px-2 py-0.5 rounded-full ${r.source === 'manual' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-700'}`}
                  >
                    {r.source === 'manual' ? 'Manual' : 'Automatic'}
                  </span>
                  <span className="text-xs text-gray-500">{r.exact ? `Rate of ${r.date}` : `Nearest earlier rate, ${r.date}`}</span>
                </div>
                {stale && (
                  <p data-testid={`stale-warning-${r.to}`} className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    This manual rate is more than {STALE_MANUAL_DAYS} days old. Enter a new one or use today&apos;s rate.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="number"
                    step="any"
                    min="0"
                    aria-label={`Manual rate for ${r.to}`}
                    placeholder={`Manual rate (1 ${r.from} = ? ${r.to})`}
                    value={draft}
                    onChange={(e) => setDrafts({ ...drafts, [r.to]: e.target.value })}
                    className={`${inputClass} w-56`}
                  />
                  <Button type="button" variant="outline" onClick={() => handleUseToday(r.to)}>
                    Use today&apos;s rate
                  </Button>
                </div>
                {shown !== null && <p className="text-xs text-gray-500">{formatRateHelper(r.from, r.to, shown)}</p>}
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <select aria-label="Add a currency" value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} className={inputClass}>
              <option value="">Add a currency...</option>
              {addable.map((c) => (
                <option key={c} value={c}>{getCurrencyOptionLabel(c)}</option>
              ))}
            </select>
            <input
              type="number"
              step="any"
              min="0"
              aria-label="Rate for the new currency"
              placeholder={`1 ${data.storeCurrency} = ?`}
              value={newRate}
              onChange={(e) => setNewRate(e.target.value)}
              className={`${inputClass} w-40`}
            />
            <Button type="button" variant="outline" onClick={handleAdd}>Add</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Rate history</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="fx-history">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Pair</th>
                  <th className="py-2 pr-4">Rate</th>
                  <th className="py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr><td colSpan={4} className="py-3 text-gray-500">No rates stored yet.</td></tr>
                )}
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4">{h.date}</td>
                    <td className="py-2 pr-4">{h.from} to {h.to}</td>
                    <td className="py-2 pr-4">{h.rate}</td>
                    <td className="py-2">{h.source === 'manual' ? 'Manual' : 'Automatic'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Daily rates by <a href={data.provider.url} className="underline">{data.provider.name}</a>.
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          Save
        </Button>
      </div>
    </form>
  );
};
