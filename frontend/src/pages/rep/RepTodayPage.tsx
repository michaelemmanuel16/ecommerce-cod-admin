import React, { useEffect, useState, useCallback } from 'react';
import clsx from 'clsx';
import { repService, type TodayStats, type RewardProgressResult, type RewardTierConfig } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';
import { formatCurrency } from '../../utils/format';
import { RepPageFrame, RepLoadState } from './RepPageFrame';

const DAY_MONTH_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
});

const MONTH_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
});

export const RepTodayPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const storeCurrency = useConfigStore((s) => s.currency);

  const [todayData, setTodayData] = useState<TodayStats | null>(null);
  const [rewardData, setRewardData] = useState<RewardProgressResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeCurrency = rewardData?.currency || storeCurrency;

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
  const todayLabel = DAY_MONTH_FORMATTER.format(new Date());
  const monthName = MONTH_FORMATTER.format(new Date());

  const confirmedCount = todayData?.confirmed ?? 0;
  const callsDoneCount = todayData?.callsDone ?? 0;
  const upsellVal = formatCurrency(todayData?.upsellExtra ?? 0, activeCurrency);

  const hasTarget = Boolean(todayData?.targetProgress?.hasTarget && rewardData?.target);
  const targetReached = Boolean(rewardData?.targetReached);

  // A tier the owner has not set shows "Not set"; no amount is invented (F-1231).
  const tierText = (t: RewardTierConfig | null | undefined) =>
    t ? `${formatCurrency(t.amount, activeCurrency)}${t.dayOff ? ' + paid day off' : ''}` : 'Not set';
  const tier100Desc = tierText(rewardData?.tiers?.tier100);
  const tier120Desc = tierText(rewardData?.tiers?.tier120);
  const distanceText = rewardData?.distance?.message ?? '';

  const confRate = todayData?.confirmationRate;
  const delivRate = todayData?.deliveredFromConfirmed;
  const ttfcMinutes = todayData?.timeToFirstCall?.medianMinutes;

  if (error && !loading) {
    return (
      <RepPageFrame
        className="rep-today-view"
        testId="rep-today-page"
        title={`Hi, ${user?.firstName || 'there'}`}
        subtitle={`${todayLabel} · Your confirmations and your pay, in one place.`}
      >
        <RepLoadState
          error={error}
          onRetry={() => void fetchData()}
          errorTestId="today-error-state"
          retryTestId="today-retry-btn"
          cardStyle={{ padding: 24, textAlign: 'center', marginTop: 16 }}
          errorStyle={{ color: 'var(--ink-2)', marginBottom: 12 }}
        />
      </RepPageFrame>
    );
  }

  return (
    <RepPageFrame
      className="rep-today-view"
      testId="rep-today-page"
      title={`Hi, ${user?.firstName || 'there'}`}
      subtitle={`${todayLabel} · Your confirmations and your pay, in one place.`}
    >
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
                  : rewardData?.message}
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
                      {targetReached ? 'Reached' : distanceText}
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
    </RepPageFrame>
  );
};

export default RepTodayPage;
