import React, { useCallback, useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '../../components/ui/Table';
import { Tooltip } from '../../components/ui/Tooltip';
import { PayoutForm } from '../../components/payouts/PayoutForm';
import { usePermissions } from '../../hooks/usePermissions';
import { payoutsService, type RepOwedRow, type RepsOwed } from '../../services/payouts.service';
import { apiErrorMessage } from '../../utils/apiError';
import { formatCurrency, formatDate, todayYmd } from '../../utils/format';

/**
 * Rep commissions tab (F-914, M5-T38): every rep with what was earned, paid, paid in the chosen month (this month to start)
 * and is owed, and "Record payout", which opens the one payout form for that rep. The tiles are the server's totals. The ledger
 * account behind it is 2020 Commissions payable. Inactive reps show only while owed something, unless the box is ticked.
 */
export const RepCommissions: React.FC = () => {
  const { can } = usePermissions();
  const canCreate = can('payouts', 'create');
  const [data, setData] = useState<RepsOwed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<RepOwedRow | null>(null);
  const [month, setMonth] = useState(todayYmd().slice(0, 7));
  const [includeInactive, setIncludeInactive] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await payoutsService.repsOwed({ month, includeInactive }));
      setError(null);
    } catch (e) {
      setError(apiErrorMessage(e, 'The rep commissions could not load.'));
    }
  }, [month, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-gray-500">Loading rep commissions…</p>;
  const { reps, totals } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><p className="text-xs text-gray-500">Commission owed</p><p className="text-xl font-bold" data-testid="tile-owed">{formatCurrency(totals.owed)}</p><p className="text-xs text-gray-500">Posts to 2020 Commissions payable</p></Card>
        <Card><p className="text-xs text-gray-500">Paid in month</p><p className="text-xl font-bold" data-testid="tile-paid-in-month">{formatCurrency(totals.paidInMonth)}</p></Card>
        <Card><p className="text-xs text-gray-500">Reps owed</p><p className="text-xl font-bold">{totals.repsOwed}</p></Card>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-44"><Input id="rep-month" label="Month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm text-gray-700 pb-2">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Show inactive reps
        </label>
      </div>

      <Card padding="none">
        <section aria-label="Rep commissions">
          {reps.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-500">No reps yet.</p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell isHeader>Rep</TableCell>
                  <TableCell isHeader className="text-right">Delivered</TableCell>
                  <TableCell isHeader className="text-right">Commission</TableCell>
                  <TableCell isHeader className="text-right">Upsell reward</TableCell>
                  <TableCell isHeader className="text-right">Target reward</TableCell>
                  <TableCell isHeader className="text-right">Earned</TableCell>
                  <TableCell isHeader className="text-right">Paid</TableCell>
                  <TableCell isHeader className="text-right">Paid in month</TableCell>
                  <TableCell isHeader className="text-right">Owed</TableCell>
                  <TableCell isHeader>Last payout</TableCell>
                  <TableCell isHeader><span className="sr-only">Action</span></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reps.map((r) => {
                  const button = (
                    <Button size="sm" variant="outline" disabled={!canCreate} onClick={() => setPaying(r)} aria-label={`Record payout for ${r.firstName} ${r.lastName}`}>
                      <Wallet className="w-4 h-4 mr-1" />
                      Record payout
                    </Button>
                  );
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.firstName} {r.lastName}</TableCell>
                      <TableCell className="text-right">{r.delivered.toLocaleString('en-GB')}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.commission)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.upsellReward)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.targetReward)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.earned)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.paid)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(r.paidInMonth)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(r.owed)}</TableCell>
                      <TableCell>{r.lastPayout ? formatDate(r.lastPayout) : '—'}</TableCell>
                      <TableCell className="text-right">
                        {canCreate ? button : <Tooltip content="You need the payouts permission to record a payout" position="left">{button}</Tooltip>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
      </Card>

      {paying && (
        <PayoutForm
          personId={paying.id}
          personName={`${paying.firstName} ${paying.lastName}`}
          onClose={() => setPaying(null)}
          onRecorded={load}
        />
      )}
    </div>
  );
};
