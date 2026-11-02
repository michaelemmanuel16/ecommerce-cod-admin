import { useEffect, useMemo, useState } from 'react';
import { Button, Select, Tag } from '../../components/ui-v2';
import { targetsService, type Calculators, type SaveTargetInput, type Tree } from '../../services/targets.service';
import { apiMessage } from '../orders/importText';
import { compactMoney, monthName } from '../dashboard/format';
import { NO_DATA, formatCount } from '../targets/model';
import { parseNumber } from './model';

interface Props {
  year: number;
  /** 'YYYY-MM': the month the role targets are for (this month). */
  month: string;
  currency: string;
  onBack: () => void;
  onNext: () => void;
}

interface Driver {
  key: 'call' | 'delivery' | 'marketing';
  label: string;
  /** Matches the role the target belongs to by name; the person can pick another. */
  match: RegExp;
  metric: string;
  unit: string;
  value: number | null;
  words: string;
  source: string;
}

const driversOf = (c: Calculators, currency: string): Driver[] => [
  { key: 'call', label: 'Call reps', match: /call/i, metric: 'confirmed_delivered', unit: 'count', value: c.ordersDelivered, source: 'Delivered orders needed: the month target ÷ the planned average order',
    words: `${formatCount(c.ordersDelivered)} confirmed orders that get delivered, counted at month close` },
  { key: 'delivery', label: 'Delivery', match: /deliver/i, metric: 'delivery_success_rate', unit: 'percent', value: c.deliverySuccessRate, source: 'Your delivery success driver',
    words: `${c.deliverySuccessRate}% delivery success` },
  { key: 'marketing', label: 'Marketing', match: /market/i, metric: 'max_cost_per_order', unit: 'money', value: c.maxCostPerOrder ?? null, source: 'Profit per delivered order × the planned yield',
    words: c.maxCostPerOrder == null ? NO_DATA : `Cost per order under ${compactMoney(c.maxCostPerOrder, currency)}` },
];

/**
 * Step 4, Driver targets (F-1111): the role targets that follow from the drivers saved in step 3, set for this month, and the split of
 * the call rep target between the people who hold that role. The split may add up to less (what is left is the role pool) and never to
 * more. It saves through the same target API as the Targets page.
 */
export function StepDrivers({ year, month, currency, onBack, onNext }: Props) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [calc, setCalc] = useState<Calculators | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [roleOf, setRoleOf] = useState<Record<string, string>>({});
  const [split, setSplit] = useState<Record<number, string>>({});

  useEffect(() => {
    let alive = true;
    Promise.all([targetsService.tree(year, month), targetsService.calculators(month)])
      .then(([t, c]) => {
        if (!alive) return;
        setTree(t);
        setCalc(c);
        const roles = t.roles ?? [];
        setRoleOf(Object.fromEntries(driversOf(c, currency).map((d) => [d.key, String(roles.find((r) => d.match.test(r.roleName))?.roleId ?? '')])));
        setSplit(Object.fromEntries(roles.flatMap((r) => r.holders.map((h) => [h.userId, h.target ? String(h.target.value) : '']))));
      })
      .catch(async (err) => { if (alive) setError(await apiMessage(err, 'Save the North Star in step 3 first: the role targets come from it.')); });
    return () => { alive = false; };
  }, [year, month, currency]);

  const drivers = useMemo(() => (calc ? driversOf(calc, currency) : []), [calc, currency]);
  const roles = tree?.roles ?? [];
  const callRole = roles.find((r) => String(r.roleId) === roleOf.call);
  const callTarget = drivers.find((d) => d.key === 'call')?.value ?? 0;
  const holders = callRole?.holders ?? [];
  const given = holders.reduce((n, h) => n + (parseNumber(split[h.userId] ?? '') ?? 0), 0);
  const over = given > callTarget;

  const save = async () => {
    if (over) return;
    setSaving(true);
    setError(null);
    try {
      // One call, one transaction: the role targets first, then the people's shares of the call rep target
      const saves: SaveTargetInput[] = [];
      for (const d of drivers) {
        const roleId = Number(roleOf[d.key]);
        if (!roleId || d.value === null) continue;
        saves.push({ scope: 'role', metric: d.metric, unit: d.unit, value: d.value, period: month, roleId });
      }
      for (const h of holders) {
        const value = parseNumber(split[h.userId] ?? '');
        if (value && value > 0) saves.push({ scope: 'person', metric: 'confirmed_delivered', unit: 'count', value, period: month, roleId: callRole!.roleId, userId: h.userId });
      }
      if (saves.length > 0) await targetsService.saveBatch(saves);
      onNext();
    } catch (err) {
      setError(await apiMessage(err, 'The targets could not be saved. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="nstep4">
      <h2>Driver targets</h2>
      <p>These role targets come from your drivers, for {monthName(`${month}-01`)}. Split the call rep target between your people. It cannot add up to more than the role target.</p>
      {error && <div className="authnote bad" role="alert" style={{ marginBottom: 14 }}>{error}</div>}
      {!calc && !error && <p>Loading the role targets...</p>}
      {calc && (
        <>
          <table>
            <thead><tr><th>Role</th><th>Target</th><th>Where it comes from</th></tr></thead>
            <tbody>
              {drivers.map((d) => (
                <tr key={d.key}>
                  <td>
                    <b>{d.label}</b>
                    <Select compact label={`Role for ${d.label}`} value={roleOf[d.key] ?? ''} onChange={(e) => setRoleOf({ ...roleOf, [d.key]: e.target.value })}>
                      <option value="">Choose a role</option>
                      {roles.map((r) => <option key={r.roleId} value={r.roleId}>{r.roleName}</option>)}
                    </Select>
                  </td>
                  <td>{d.words}</td>
                  <td>{d.source}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {callRole && (
            <>
              <h3 style={{ marginTop: 20 }}>Split the call rep target</h3>
              {holders.length === 0 ? (
                <p><Tag>Vacant</Tag> No one holds {callRole.roleName} yet. Invite your team in step 5, then split the target on the Targets page.</p>
              ) : (
                <div className="wgrid" style={{ marginTop: 8 }}>
                  {holders.map((h) => (
                    <div className="fl" key={h.userId}>
                      <label htmlFor={`split-${h.userId}`}>{h.name}{h.kind === 'ai_agent' ? ' (AI)' : ''}</label>
                      <input id={`split-${h.userId}`} inputMode="numeric" value={split[h.userId] ?? ''} onChange={(e) => setSplit({ ...split, [h.userId]: e.target.value })} />
                    </div>
                  ))}
                </div>
              )}
              {holders.length > 0 && (
                <p className={`nssum${over ? ' bad' : ''}`} role={over ? 'alert' : undefined}>
                  {over ? `Total ${formatCount(given)} is ${formatCount(given - callTarget)} over the role target of ${formatCount(callTarget)}.` : `Total ${formatCount(given)} of ${formatCount(callTarget)}.`}
                </p>
              )}
            </>
          )}
        </>
      )}
      <div className="wfoot">
        <Button onClick={onBack}>Back</Button>
        <div className="right">
          <Button onClick={onNext}>Skip for now</Button>
          <Button variant="primary" disabled={!calc || saving || over} onClick={save}>{saving ? 'Saving...' : 'Save driver targets and continue'}</Button>
        </div>
      </div>
    </div>
  );
}

