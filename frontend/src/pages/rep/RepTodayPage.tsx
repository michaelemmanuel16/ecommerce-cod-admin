import React, { useEffect, useState, useCallback } from 'react';
import clsx from 'clsx';
import { repService, type TodayStats, type RewardProgressResult } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { formatCurrency } from '../../utils/format';

export const RepTodayPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const storeCurrency = useConfigStore((s) => s.currency);

  const [todayData, setTodayData] = useState<TodayStats | null>(null);
  const [rewardData, setRewardData] = useState<RewardProgressResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeCurrency = (rewardData?.currency === 'GH₵' ? 'GHS' : rewardData?.currency) || storeCurrency || 'GHS';

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [todayRes, rewardRes] = await Promise.all([
        repService.getToday(),
        repService.getRewardProgress(),
      ]);
      setTodayData(todayRes);
      setRewardData(rewardRes);
    } catch (err: any) {
      setError(err?.message || 'Could not load today data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Today's date for display (e.g. 17 Oct)
  const todayLabel = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(new Date());

  const monthName = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
  }).format(new Date());

  const confirmedCount = todayData?.confirmed ?? 0;
  const callsDoneCount = todayData?.callsDone ?? 0;
  const upsellVal = todayData?.upsellExtra ? formatCurrency(todayData.upsellExtra, activeCurrency) : formatCurrency(0, activeCurrency);

  const hasTarget = Boolean(todayData?.targetProgress?.hasTarget && rewardData?.target);
  const targetReached = Boolean(rewardData?.targetReached);

  const tier100 = rewardData?.tiers?.tier100;
  const tier120 = rewardData?.tiers?.tier120;
  const tier100Amount = tier100?.bonusAmount ?? (tier100 as any)?.amount;
  const tier100Label = tier100Amount ? formatCurrency(tier100Amount, activeCurrency) : '';
  const tier100Desc = tier100?.description || (tier100Label ? `${tier100Label} bonus` : '');
  const tier120Amount = tier120?.bonusAmount ?? (tier120 as any)?.amount;
  const tier120Bonus = tier120Amount ? formatCurrency(tier120Amount, activeCurrency) : '';
  const tier120Desc = tier120?.description || (tier120Bonus ? `${tier120Bonus} + paid day off` : '');

  const confRate = todayData?.confirmationRate;
  const delivRate = todayData?.deliveredFromConfirmed;
  const ttfcMinutes = todayData?.timeToFirstCall?.medianMinutes;

  if (error && !loading) {
    return (
      <div className="rep-today-view" data-testid="rep-today-page">
        <div className="head">
          <div>
            <h1>Hi, {user?.firstName || 'there'}</h1>
            <p>{todayLabel} · Your confirmations and your pay, in one place.</p>
          </div>
        </div>
        <div className="card" style={{ padding: 24, textAlign: 'center', marginTop: 16 }} data-testid="today-error-state">
          <p style={{ color: 'var(--ink-2)', marginBottom: 12 }}>{error}</p>
          <button
            type="button"
            className="btn"
            onClick={() => void fetchData()}
            data-testid="today-retry-btn"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rep-today-view" data-testid="rep-today-page">
      <div className="head">
        <div>
          <h1>Hi, {user?.firstName || 'there'}</h1>
          <p>{todayLabel} · Your confirmations and your pay, in one place.</p>
        </div>
      </div>

      <div className="today">
        {/* Hero: Confirmed today */}
        <div className="hero" data-testid="confirmed-hero">
          <small>Confirmed today</small>
          <div className="big num">
            <span data-testid="b-today">{confirmedCount}</span>
          </div>
          <div className="of">
            Your target counts confirmed orders that get delivered, at month close.
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 13, opacity: 0.9 }}>
            <span>Calls done: <b>{callsDoneCount}</b></span>
            <span>Upsell: <b>{upsellVal}</b></span>
          </div>
        </div>

        {/* Reward Card */}
        <div className="card rew" data-testid="reward-card">
          <div className="row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3>Next reward</h3>
            {!hasTarget ? (
              <span className="tag n" data-testid="no-target-tag">
                No target set
              </span>
            ) : (
              <span
                className="tag ok"
                data-testid="reward-tag"
              >
                {targetReached
                  ? 'Paid after month close'
                  : rewardData?.message || (tier100Label ? `${rewardData?.distance ?? 0} more to ${tier100Label}` : `${rewardData?.distance ?? 0} more`)}
              </span>
            )}
          </div>

          {!hasTarget ? (
            <div style={{ marginTop: 16 }}>
              <p style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>
                No personal target set for this month.
              </p>
              <p style={{ color: 'var(--ink-3)', fontSize: 12.5, marginTop: 4 }}>
                Ask your manager to set a monthly target in Staff &amp; roles.
              </p>
            </div>
          ) : (
            <>
              <div
                className="row"
                style={{
                  marginTop: 10,
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                }}
              >
                <span
                  className="num"
                  style={{
                    fontSize: 30,
                    fontWeight: 800,
                    fontFamily: '"Bricolage Grotesque", sans-serif',
                  }}
                  data-testid="b-conf"
                >
                  {rewardData?.actual ?? 0}
                </span>
                <span className="sub" style={{ color: 'var(--ink-2)', fontSize: 13 }}>
                  of {rewardData?.target} confirmed and delivered orders in {monthName}
                </span>
              </div>

              <div className="prog" data-testid="reward-progress-bar">
                <i
                  data-testid="reward-progress-fill"
                  style={{
                    width: `${Math.min(100, Math.max(0, rewardData?.percent ?? 0))}%`,
                  }}
                />
              </div>

              {rewardData?.tiers && (
                <div className="tier" data-testid="reward-tiers-row">
                  <div
                    className={clsx(
                      rewardData.tier === '100' ? 'got' : !targetReached ? 'next' : ''
                    )}
                    data-testid="tier-100"
                  >
                    <b>100%</b>
                    <span>{tier100Desc}</span>
                    <br />
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                      {targetReached ? 'Reached' : `${rewardData.distance ?? 0} more`}
                    </span>
                  </div>
                  <div
                    className={clsx(rewardData.tier === '120' ? 'got' : rewardData.tier === '100' ? 'next' : '')}
                    data-testid="tier-120"
                  >
                    <b>120%</b>
                    <span>{tier120Desc}</span>
                  </div>
                </div>
              )}

              <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12 }} data-testid="reward-note">
                {targetReached ? 'Paid after month close' : rewardData?.note || 'The reward is paid after month close.'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="tkpis">
        <div className="card tk" data-testid="tile-confirmation-rate">
          <small>Confirmation rate</small>
          <div className="v" data-testid="confirmation-rate-value">
            {typeof confRate === 'number' ? `${confRate}%` : '—'}
          </div>
          <div className="s">Confirmed ÷ assigned</div>
        </div>

        <div className="card tk" data-testid="tile-delivered-rate">
          <small>Delivered from my confirmed</small>
          <div className="v" data-testid="delivered-rate-value">
            {typeof delivRate === 'number' ? `${delivRate}%` : '—'}
          </div>
          <div className="s">Delivered ÷ closed orders</div>
        </div>

        <div className="card tk" data-testid="tile-ttfc">
          <small>Time to first call</small>
          <div className="v" data-testid="ttfc-value">
            {typeof ttfcMinutes === 'number' ? `${ttfcMinutes} min` : '—'}
          </div>
          <div className="s">
            {todayData?.timeToFirstCall?.operatingHoursSet
              ? `Median, ${monthName}`
              : 'Set operating hours in Settings'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RepTodayPage;
