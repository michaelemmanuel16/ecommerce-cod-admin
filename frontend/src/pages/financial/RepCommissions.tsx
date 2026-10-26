import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { PayoutForm } from '../../components/payouts/PayoutForm';
import { usePermissions } from '../../hooks/usePermissions';
import { payoutsService, type RepOwedRow } from '../../services/payouts.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, formatDate } from '../../utils/format';

/**
 * Rep commissions tab (F-914, M5-T38): every rep with what was earned, paid and is owed, and "Record payout", which opens
 * the one payout form for that rep. The tiles add up the table. The ledger account behind it is 2020 Commissions payable.
 */
export const RepCommissions: React.FC = () => {
  const { can } = usePermissions();
  const canCreate = can('payouts', 'create');
  const [reps, setReps] = useState<RepOwedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<RepOwedRow | null>(null);

  const load = useCallback(async () => {
    try {
      setReps(await payoutsService.repsOwed());
      setError(null);
    } catch (e) {
      setError(apiErrorMessage(e, 'The rep commissions could not load.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const rows = reps ?? [];
    const sum = (pick: (r: RepOwedRow) => string) => rows.reduce((acc, r) => acc + Math.round(Number(pick(r)) * 100), 0) / 100;
    return { owed: sum((r) => r.owed), paid: sum((r) => r.paid), reps: rows.filter((r) => Number(r.owed) > 0).length };
  }, [reps]);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!reps) return <p className="text-sm text-gray-500">Loading rep commissions…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><div><p className="text-xs text-gray-500">Commission owed</p><p className="text-xl font-bold" data-testid="tile-owed">{formatCurrency(totals.owed)}</p><p className="text-xs text-gray-500">Posts to 2020 Commissions payable</p></div></Card>
        <Card><div><p className="text-xs text-gray-500">Paid so far</p><p className="text-xl font-bold">{formatCurrency(totals.paid)}</p></div></Card>
        <Card><div><p className="text-xs text-gray-500">Reps owed</p><p className="text-xl font-bold">{totals.reps}</p></div></Card>
      </div>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Rep commissions">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="p-3 text-left" scope="col">Rep</th>
                <th className="p-3 text-right" scope="col">Delivered</th>
                <th className="p-3 text-right" scope="col">Commission</th>
                <th className="p-3 text-right" scope="col">Upsell reward</th>
                <th className="p-3 text-right" scope="col">Target reward</th>
                <th className="p-3 text-right" scope="col">Earned</th>
                <th className="p-3 text-right" scope="col">Paid</th>
                <th className="p-3 text-right" scope="col">Owed</th>
                <th className="p-3 text-left" scope="col">Last payout</th>
                <th className="p-3" scope="col"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {reps.length === 0 && (
                <tr><td colSpan={10} className="p-6 text-center text-gray-500">No reps yet.</td></tr>
              )}
              {reps.map((r) => {
                const button = (
                  <Button size="sm" variant="outline" disabled={!canCreate} onClick={() => setPaying(r)} aria-label={`Record payout for ${r.firstName} ${r.lastName}`}>
                    <Wallet className="w-4 h-4 mr-1" />
                    Record payout
                  </Button>
                );
                return (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="p-3 whitespace-nowrap font-medium">{r.firstName} {r.lastName}</td>
                    <td className="p-3 text-right">{r.delivered.toLocaleString('en-GB')}</td>
                    <td className="p-3 text-right">{formatCurrency(r.commission)}</td>
                    <td className="p-3 text-right">{formatCurrency(r.upsellReward)}</td>
                    <td className="p-3 text-right">{formatCurrency(r.targetReward)}</td>
                    <td className="p-3 text-right">{formatCurrency(r.earned)}</td>
                    <td className="p-3 text-right">{formatCurrency(r.paid)}</td>
                    <td className="p-3 text-right font-semibold">{formatCurrency(r.owed)}</td>
                    <td className="p-3 whitespace-nowrap">{r.lastPayout ? formatDate(r.lastPayout) : '—'}</td>
                    <td className="p-3 text-right">
                      {canCreate ? button : <Tooltip content="You need the payouts permission to record a payout" position="left">{button}</Tooltip>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {paying && (
        <PayoutForm
          personId={paying.id}
          personName={`${paying.firstName} ${paying.lastName}`}
          isOpen
          onClose={() => setPaying(null)}
          onRecorded={() => void load()}
        />
      )}
    </div>
  );
};
