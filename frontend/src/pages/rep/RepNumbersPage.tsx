import React, { useEffect, useState } from 'react';
import { repService, type RepNumbersResult } from '../../services/rep.service';
import { formatCurrency } from '../../utils/format';

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const RepNumbersPage: React.FC = () => {
  const [data, setData] = useState<RepNumbersResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNumbers = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await repService.getNumbers();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Could not load numbers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNumbers();
  }, []);

  if (loading && !data) {
    return (
      <section className="view on" id="numbers" aria-label="My numbers">
        <div className="head">
          <div>
            <h1>My numbers</h1>
            <p>How your calls and orders are doing.</p>
          </div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p>Loading numbers...</p>
        </div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="view on" id="numbers" aria-label="My numbers">
        <div className="head">
          <div>
            <h1>My numbers</h1>
            <p>How your calls and orders are doing.</p>
          </div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ color: 'var(--coral)', fontWeight: 600 }}>{error}</p>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => void loadNumbers()}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  const confirmed = data?.confirmed ?? 0;
  const targetHit = data?.targetHit;
  const confirmationRate = data?.confirmationRate;
  const deliverySuccess = data?.deliveredFromConfirmedRate;
  const upsellRate = data?.upsellRate;
  const extraValueAdded = data?.extraValueAdded ?? '0.00';
  const timeToFirstCall = data?.timeToFirstCall;

  const ranks = data?.ranks;
  const callRepRank = ranks?.callRep;
  const upsellRank = ranks?.upsell;

  const breakdown = data?.orderBreakdown ?? { confirmed: 0, delivered: 0, failedOrReturned: 0, stillOpen: 0 };
  const breakdownTotal = breakdown.confirmed;
  const delWidth = breakdownTotal > 0 ? (breakdown.delivered / breakdownTotal) * 100 : 0;
  const failWidth = breakdownTotal > 0 ? (breakdown.failedOrReturned / breakdownTotal) * 100 : 0;
  const openWidth = breakdownTotal > 0 ? (breakdown.stillOpen / breakdownTotal) * 100 : 0;

  const calls = data?.calls ?? { today: 0, thisWeek: 0, thisMonth: 0, averagePerDay: 0 };

  const outcomes = data?.callOutcomes ?? {};
  const outConfirmed = outcomes.confirmed ?? 0;
  const outNotReachable = outcomes.not_reachable ?? 0;
  const outDeclined = outcomes.declined ?? 0;
  const outCallBack = outcomes.call_back_later ?? outcomes.call_back ?? 0;
  const outWrongNumber = (outcomes.wrong_number ?? 0) + (outcomes.other ?? 0);
  const totalOutcomes = outConfirmed + outNotReachable + outDeclined + outCallBack + outWrongNumber;

  const cPct = totalOutcomes > 0 ? (outConfirmed / totalOutcomes) * 100 : 0;
  const nrPct = totalOutcomes > 0 ? (outNotReachable / totalOutcomes) * 100 : 0;
  const dPct = totalOutcomes > 0 ? (outDeclined / totalOutcomes) * 100 : 0;
  const cbPct = totalOutcomes > 0 ? (outCallBack / totalOutcomes) * 100 : 0;
  const wnPct = totalOutcomes > 0 ? (outWrongNumber / totalOutcomes) * 100 : 0;

  const callsPerDay = data?.callsPerDay ?? [];
  const maxDayCount = Math.max(1, ...callsPerDay.map((c) => c.count));

  return (
    <section className="view on" id="numbers" aria-label="My numbers">
      <div className="head">
        <div>
          <h1>My numbers</h1>
          <p>{data?.period ? `${data.period} · ` : ''}How your calls and orders are doing.</p>
        </div>
      </div>

      <div className="card">
        {/* KPI Grid */}
        <div className="nums" data-testid="numbers-kpi-grid">
          <div className="drv" data-testid="kpi-confirmed">
            <small>Confirmed</small>
            <b className="num" id="b-conf3">{confirmed}</b>
            <em>
              {targetHit
                ? `${targetHit.actual} of ${targetHit.target} delivered target`
                : '—'}
            </em>
          </div>

          <div className="drv" data-testid="kpi-confirmation-rate">
            <small>Confirmation rate</small>
            <b className="num">
              {confirmationRate !== null && confirmationRate !== undefined ? `${confirmationRate}%` : '—'}
            </b>
            <em>target 70%</em>
          </div>

          <div className="drv" data-testid="kpi-delivery-success">
            <small>Delivery success</small>
            <b className="num">
              {deliverySuccess !== null && deliverySuccess !== undefined ? `${deliverySuccess}%` : '—'}
            </b>
            <em>{breakdown.delivered} delivered</em>
          </div>

          <div className="drv" data-testid="kpi-upsell-rate">
            <small>Upsell rate</small>
            <b className="num">
              {upsellRate !== null && upsellRate !== undefined ? `${upsellRate}%` : '—'}
            </b>
            <em>of your orders</em>
          </div>

          <div className="drv" data-testid="kpi-extra-value">
            <small>Extra value added</small>
            <b className="num">{formatCurrency(extraValueAdded)}</b>
            <em>on delivered orders</em>
          </div>

          <div className="drv" data-testid="kpi-time-to-first-call">
            <small>Time to first call</small>
            <b className="num">
              {timeToFirstCall !== null && timeToFirstCall !== undefined ? `${timeToFirstCall} min` : '—'}
            </b>
            <em>median</em>
          </div>
        </div>

        {/* Ranks */}
        <div className="ranks" data-testid="numbers-ranks">
          <div className="rk" data-testid="rank-call-reps">
            <div className="rank">
              {callRepRank?.rank ? callRepRank.rank : '—'}
            </div>
            <div>
              <small>Rank in call reps</small>
              <b>
                {callRepRank?.rank
                  ? `${ordinal(callRepRank.rank)} of ${callRepRank.total}`
                  : '—'}
              </b>
            </div>
          </div>

          <div className="rk" data-testid="rank-upsell">
            <div className="rank">
              {upsellRank?.rank ? upsellRank.rank : '—'}
            </div>
            <div>
              <small>Rank in Upsell</small>
              <b>
                {upsellRank?.rank
                  ? `${ordinal(upsellRank.rank)} of ${upsellRank.total}`
                  : '—'}
              </b>
            </div>
          </div>
        </div>

        {/* Where my confirmed orders are */}
        <div className="sh" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
          Where my {breakdown.confirmed} confirmed orders are
        </div>
        <div className="stack" style={{ marginTop: 10 }} data-testid="orders-stack-bar">
          {breakdownTotal > 0 ? (
            <>
              <i style={{ width: `${delWidth}%`, background: 'var(--mint)' }} />
              <i style={{ width: `${failWidth}%`, background: 'var(--coral)' }} />
              <i style={{ width: `${openWidth}%`, background: 'var(--gold)' }} />
            </>
          ) : (
            <i style={{ width: '100%', background: 'var(--hover)' }} />
          )}
        </div>
        <div className="leg" data-testid="orders-stack-legend">
          <span>
            <i style={{ background: 'var(--mint)' }} />
            Delivered {breakdown.delivered}
          </span>
          <span>
            <i style={{ background: 'var(--coral)' }} />
            Failed or returned {breakdown.failedOrReturned}
          </span>
          <span>
            <i style={{ background: 'var(--gold)' }} />
            Still open {breakdown.stillOpen}
          </span>
        </div>

        {/* My calls */}
        <div className="sh" style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 14 }}>
          My calls
        </div>
        <div className="callrow" data-testid="calls-row">
          <div>
            <b className="num">{calls.today}</b>Today
          </div>
          <div>
            <b className="num">{calls.thisWeek}</b>This week
          </div>
          <div>
            <b className="num">{calls.thisMonth}</b>This month
          </div>
          <div>
            <b className="num">{calls.averagePerDay}</b>Average a day
          </div>
        </div>

        {/* Call outcomes this month */}
        <div className="sh">Call outcomes this month</div>
        <div className="stack" style={{ marginTop: 10 }} data-testid="outcomes-stack-bar">
          {totalOutcomes > 0 ? (
            <>
              <i style={{ width: `${cPct}%`, background: 'var(--mint)' }} />
              <i style={{ width: `${nrPct}%`, background: 'var(--gold)' }} />
              <i style={{ width: `${dPct}%`, background: 'var(--coral)' }} />
              <i style={{ width: `${cbPct}%`, background: 'var(--violet)' }} />
              <i style={{ width: `${wnPct}%`, background: 'var(--ink-3)' }} />
            </>
          ) : (
            <i style={{ width: '100%', background: 'var(--hover)' }} />
          )}
        </div>
        <div className="leg" data-testid="outcomes-stack-legend">
          <span>
            <i style={{ background: 'var(--mint)' }} />
            Confirmed {outConfirmed}
          </span>
          <span>
            <i style={{ background: 'var(--gold)' }} />
            Not reachable {outNotReachable}
          </span>
          <span>
            <i style={{ background: 'var(--coral)' }} />
            Declined {outDeclined}
          </span>
          <span>
            <i style={{ background: 'var(--violet)' }} />
            Call back {outCallBack}
          </span>
          <span>
            <i style={{ background: 'var(--ink-3)' }} />
            Wrong number or other {outWrongNumber}
          </span>
        </div>

        {/* Calls a day, last 14 days */}
        <div className="sh">Calls a day, last 14 days</div>
        <div className="bars" id="bars" data-testid="calls-bars" aria-hidden="true">
          {callsPerDay.map((day, idx) => {
            const heightPct = day.count > 0 ? Math.max(6, Math.round((day.count / maxDayCount) * 100)) : 6;
            return (
              <i
                key={day.date || idx}
                className={day.isToday ? 't' : ''}
                style={{ height: `${heightPct}%` }}
                title={`${day.date}: ${day.count} calls`}
              />
            );
          })}
        </div>
        <p className="muted" style={{ padding: '6px 20px 16px', fontSize: 13, color: 'var(--ink-3)' }}>
          Today is still counting.
        </p>
      </div>
    </section>
  );
};

export default RepNumbersPage;
