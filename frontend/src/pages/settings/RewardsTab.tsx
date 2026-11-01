import { useEffect, useState, type ReactNode } from 'react';
import { Bot, CalendarCheck, Crown, PhoneCall, TrendingUp, Truck, type LucideIcon } from 'lucide-react';
import { Button, Card, useToast } from '../../components/ui-v2';
import { targetsService, type RewardSettings } from '../../services/targets.service';
import { currencySymbol } from '../../utils/format';
import { apiMessage } from '../orders/importText';

type Tone = 'mint' | 'gold' | 'pine' | 'plain';
const TONE: Record<Tone, { background: string; color: string }> = {
  mint: { background: 'var(--mint-soft)', color: 'var(--mint)' },
  gold: { background: 'var(--gold-soft)', color: 'var(--gold)' },
  pine: { background: 'var(--pine-soft)', color: 'var(--pine)' },
  plain: { background: 'var(--hover)', color: 'var(--ink-2)' },
};

/** The two roles the reward engine measures (rewardService). Any other role that already holds a saved tier is listed too. */
const PAID_ROLES: Array<{ name: string; icon: LucideIcon; who100: string; who120: string }> = [
  { name: 'Call rep', icon: PhoneCall, who100: 'Each call rep on their own target', who120: 'Beat the target by a fifth' },
  { name: 'Delivery', icon: Truck, who100: 'Delivery agents who are people', who120: 'Beat the target by a fifth' },
];

const BADGES: Array<{ icon: LucideIcon; tone: Tone; title: string; text: string }> = [
  { icon: Crown, tone: 'gold', title: 'Top of month', text: 'Best result in a role for the month' },
  { icon: CalendarCheck, tone: 'pine', title: 'Hit target 3 months running', text: '100% or more, three months in a row' },
  { icon: TrendingUp, tone: 'mint', title: 'Beat target by 20%', text: '120% or more in a month' },
];

interface RoleDraft { roleId: number; name: string; c100: string; c120: string; dayOff100: boolean; dayOff120: boolean }
interface Draft { roles: RoleDraft[]; commission: string; upsell: string; badges: boolean }

const text = (n: number | string | null | undefined) => (n === null || n === undefined ? '' : String(n));

const toDraft = (s: RewardSettings): Draft => ({
  roles: s.tiers
    .filter((t) => PAID_ROLES.some((p) => p.name === t.roleName) || t.tier100 || t.tier120)
    .sort((a, b) => Number(!PAID_ROLES.some((p) => p.name === a.roleName)) - Number(!PAID_ROLES.some((p) => p.name === b.roleName)))
    .map((t) => ({
      roleId: t.roleId, name: t.roleName, c100: text(t.tier100?.amount), c120: text(t.tier120?.amount),
      dayOff100: t.tier100?.dayOff ?? false, dayOff120: t.tier120?.dayOff ?? false,
    })),
  commission: text(s.repPay.baseCommission),
  upsell: text(s.repPay.upsellPercent),
  badges: s.badgesDisplay,
});

function Row({ icon: Icon, tone, title, note, children }: { icon: LucideIcon; tone: Tone; title: string; note: ReactNode; children: ReactNode }) {
  return (
    <div className="reward">
      <div className="ico" style={TONE[tone]}><Icon aria-hidden="true" /></div>
      <div><b>{title}</b><small>{note}</small></div>
      <div className="cost">{children}</div>
    </div>
  );
}

/**
 * Settings, Rewards (M6-T18, F-1231, F-1114): the only place reward tiers are edited. Cash tiers by role, call rep pay, and the
 * result badges switch. The API holds everything (`/api/rewards/settings`); this page keeps a draft and sends it on Save. The
 * Owner edits, everyone else reads. A 120% reward below the 100% one comes back from the API and shows on the field.
 */
export function RewardsTab({ editable }: { editable: boolean }) {
  const say = useToast();
  const [settings, setSettings] = useState<RewardSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    targetsService.rewardSettings()
      .then((s) => { if (live) { setSettings(s); setDraft(toDraft(s)); } })
      .catch(async (err) => { if (live) setLoadError(await apiMessage(err, 'The rewards could not be loaded. Try again.')); });
    return () => { live = false; };
  }, []);

  if (!settings || !draft) {
    return <Card title="Rewards"><p className="setnote" role={loadError ? 'alert' : undefined}>{loadError ?? 'Loading the rewards...'}</p></Card>;
  }

  const symbol = currencySymbol(settings.currency);
  const setRole = (roleId: number, patch: Partial<RoleDraft>) =>
    setDraft({ ...draft, roles: draft.roles.map((r) => (r.roleId === roleId ? { ...r, ...patch } : r)) });
  // The API names the role at the end of the message; that role's 120% field shows the error
  const badRole = error ? draft.roles.find((r) => error.endsWith(`for ${r.name}`))?.roleId : undefined;

  const save = async () => {
    const amounts = draft.roles.flatMap((r) => [r.c100, r.c120]).concat(draft.commission, draft.upsell);
    if (amounts.some((a) => a.trim() === '' || Number.isNaN(Number(a)))) { setError('Every amount must be a number.'); return; }
    setBusy(true);
    setError(null);
    try {
      const saved = await targetsService.saveRewardSettings({
        tiers: draft.roles.map((r) => ({ roleId: r.roleId, tier100: { amount: r.c100, dayOff: r.dayOff100 }, tier120: { amount: r.c120, dayOff: r.dayOff120 } })),
        repPay: { baseCommission: draft.commission, upsellPercent: draft.upsell },
        badgesDisplay: draft.badges,
      });
      setSettings(saved);
      setDraft(toDraft(saved));
      say('Rewards saved. Tiers apply from the next month close.');
    } catch (err) {
      setError(await apiMessage(err, 'The rewards could not be saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const money = (label: string, value: string, onChange: (v: string) => void, invalid = false) => (
    <div className="rin">
      <span>{symbol}</span>
      <input
        value={value} inputMode="decimal" aria-label={label} readOnly={!editable}
        aria-invalid={invalid || undefined} aria-describedby={invalid ? 'rewards-error' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <Card title="Rewards" aside={`Amounts are in your store currency (${symbol})`}>
      {!editable && <p className="setnote">You can view this section but not change it. The owner edits the rewards.</p>}
      <div className="sub" style={{ paddingBottom: 6 }}>
        Target tiers
        <small>Paid when a role hits its monthly target, worked out at month close on delivery-date numbers. Each role has its own rule.</small>
      </div>
      <div>
        {draft.roles.flatMap((r) => {
          const def = PAID_ROLES.find((p) => p.name === r.name);
          const icon = def?.icon ?? PhoneCall;
          return [
            <Row key={`${r.roleId}-100`} icon={icon} tone="mint" title={`${r.name} hits 100%`} note={def?.who100 ?? 'On their own target'}>
              {money(`${r.name} reward at 100 percent`, r.c100, (v) => setRole(r.roleId, { c100: v }))}
            </Row>,
            <Row
              key={`${r.roleId}-120`} icon={icon} tone="gold" title={`${r.name} hits 120%`}
              note={(
                <>
                  {def?.who120 ?? 'Beat the target by a fifth'}
                  <label className="chk" style={{ fontWeight: 500, marginTop: 2 }}>
                    <input
                      type="checkbox" checked={r.dayOff120} disabled={!editable}
                      onChange={(e) => setRole(r.roleId, { dayOff120: e.target.checked })}
                    />
                    Plus a paid day off
                  </label>
                </>
              )}
            >
              {money(`${r.name} reward at 120 percent`, r.c120, (v) => setRole(r.roleId, { c120: v }), badRole === r.roleId)}
            </Row>,
          ];
        })}
        <Row icon={Bot} tone="plain" title="Companies and AI agents" note="Delivery companies and the confirm agent">
          <b style={{ color: 'var(--ink-2)' }}>No payout</b>
        </Row>
      </div>
      {error && <div className="opserr" id="rewards-error" role="alert">{error}</div>}

      <div className="sub" style={{ paddingTop: 18 }}>Call rep pay<small>Paid to people only. AI agents get no payout.</small></div>
      <div style={{ padding: '0 20px' }}>
        <Row icon={PhoneCall} tone="pine" title="Commission" note="Per order the rep confirmed by call that is delivered. Auto-confirmed orders earn none">
          {money('Commission per confirmed order that is delivered', draft.commission, (v) => setDraft({ ...draft, commission: v }))}
        </Row>
        <Row icon={TrendingUp} tone="gold" title="Upsell reward" note="Share of the extra value added, paid when delivered">
          <div className="rin">
            <input
              value={draft.upsell} inputMode="decimal" aria-label="Upsell reward percent" readOnly={!editable}
              onChange={(e) => setDraft({ ...draft, upsell: e.target.value })}
            />
            <span>%</span>
          </div>
        </Row>
      </div>

      <div className="sub" style={{ paddingTop: 18 }}>Result badges<small>Earned only by hitting or beating a target.</small></div>
      <div className="medals three">
        {BADGES.map((b) => (
          <div className="medal" key={b.title}>
            <div className="m" style={TONE[b.tone]}><b.icon aria-hidden="true" /></div>
            <b>{b.title}</b>
            <small>{b.text}</small>
          </div>
        ))}
      </div>
      <div style={{ padding: '0 20px' }}>
        <label className="chk">
          <input type="checkbox" checked={draft.badges} disabled={!editable} onChange={(e) => setDraft({ ...draft, badges: e.target.checked })} />
          Show result badges on the screens
        </label>
      </div>

      <div className="setinfo">New tier amounts apply from the next month close. A new commission or upsell share applies to orders delivered after you save.</div>
      {editable && (
        <div className="cardfoot">
          <Button variant="primary" disabled={busy} onClick={save}>{busy ? 'Saving...' : 'Save rewards'}</Button>
        </div>
      )}
    </Card>
  );
}
