import React, { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import clsx from 'clsx';
import {
  repService,
  type RepEarningsResult,
  type RewardProgressResult,
} from '../../services/rep.service';
import { formatCurrency, formatDate } from '../../utils/format';
import { formatOrderNumber } from '../../utils/orderNumber';
import { getOrderStatusLabel } from '../../utils/orderStatus';
import { STATUS_TONE } from '../orders/model';
import type { OrderStatus } from '../../types';
import { RepPageFrame, RepLoadState } from './RepPageFrame';
import { parseMoney } from '../../utils/money';

function getTargetRewardSubtext(rewardProgress: RewardProgressResult | null): string {
  if (!rewardProgress?.target) {
    return 'No target set';
  }
  const tier100Amount = rewardProgress.tiers?.tier100?.amount;
  if (!rewardProgress.tiers || !tier100Amount) {
    return `Target: ${rewardProgress.target} confirmed and delivered`;
  }
  const formattedAmount = formatCurrency(tier100Amount, rewardProgress.currency);
  return `${formattedAmount} at ${rewardProgress.target} confirmed and delivered (100%)`;
}

export const RepEarningsPage: React.FC = () => {
  const [earnings, setEarnings] = useState<RepEarningsResult | null>(null);
  const [rewardProgress, setRewardProgress] = useState<RewardProgressResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);

  const loadRewardProgress = async () => {
    try {
      setRewardLoading(true);
      setRewardError(null);
      const res = await repService.getRewardProgress();
      setRewardProgress(res);
    } catch {
      setRewardError('Could not load target reward');
      setRewardProgress(null);
    } finally {
      setRewardLoading(false);
    }
  };

  const loadEarnings = async () => {
    try {
      const earningsRes = await repService.getEarnings();
      setEarnings(earningsRes);
    } catch (err: any) {
      setError(err?.message || 'Could not load earnings');
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      await Promise.all([loadEarnings(), loadRewardProgress()]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  if (loading && !earnings) {
    return (
      <RepPageFrame id="earnings" ariaLabel="Earnings" title="Earnings" subtitle="What you are owed, what you were paid, and your target reward.">
        <RepLoadState loading loadingText="Loading earnings..." />
      </RepPageFrame>
    );
  }

  if (error && !earnings) {
    return (
      <RepPageFrame id="earnings" ariaLabel="Earnings" title="Earnings" subtitle="What you are owed, what you were paid, and your target reward.">
        <RepLoadState error={error} onRetry={() => void loadData()} />
      </RepPageFrame>
    );
  }

  if (!earnings) return null;

  const currency = earnings.currency;
  const isOverpaid = Boolean(earnings.isOverpaid);
  const overpaidDisplay = `Overpaid ${formatCurrency(earnings.overpaid, currency)}`;
  const owedDisplay = isOverpaid ? overpaidDisplay : formatCurrency(earnings.owed, currency);

  const lines = earnings.lines ?? [];
  const payouts = earnings.payouts ?? [];

  return (
    <RepPageFrame id="earnings" ariaLabel="Earnings" title="Earnings" subtitle="What you are owed, what you were paid, and your target reward.">
      <div className="low">
        {/* Left Card: You are owed / Overpaid + breakdown + reward */}
        <div className="card" data-testid="earnings-summary-card">
          <div className="owed row" data-testid="earnings-owed-block">
            <div>
              <small>{isOverpaid ? 'Status' : 'You are owed'}</small>
              <div
                className={clsx('big num', isOverpaid && 'coral')}
                data-testid="earnings-main-amount"
              >
                {owedDisplay}
              </div>
            </div>
          </div>

          <div className="lines">
            <div className="li" data-testid="line-commission">
              <span>
                Commission
                <em>Delivered orders commission</em>
              </span>
              <b className="num">{formatCurrency(earnings.commission, currency)}</b>
            </div>

            <div className="li" data-testid="line-upsell">
              <span>
                Upsell reward
                <em>Share of extra value on delivered orders</em>
              </span>
              <b className="num">{formatCurrency(earnings.upsellReward, currency)}</b>
            </div>

            <div className="li" data-testid="line-paid">
              <span>
                Paid
                <em>Payouts made</em>
              </span>
              <b className="num">
                {parseMoney(earnings.paid) > 0 ? `− ${formatCurrency(earnings.paid, currency)}` : formatCurrency('0.00', currency)}
              </b>
            </div>

            <div
              className="li"
              style={{ background: 'var(--hover)', margin: '0 -20px', padding: '10px 20px' }}
              data-testid="line-owed-now"
            >
              <b>Owed now</b>
              <b
                className={clsx('num', isOverpaid && 'coral')}
                style={{ fontSize: 18 }}
                data-testid="owed-now-amount"
              >
                {owedDisplay}
              </b>
            </div>
          </div>

          {earnings.openOrdersNote && (
            <div className="note1" data-testid="open-orders-note">
              <Info size={16} />
              <span>{earnings.openOrdersNote}</span>
            </div>
          )}

          <div className="lines" style={{ paddingTop: 0 }}>
            <div className="li" data-testid="reward-progress-line">
              {rewardError ? (
                <>
                  <span>
                    Target reward
                    <em style={{ color: 'var(--coral)' }}>Could not load target reward</em>
                  </span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => void loadRewardProgress()}
                    disabled={rewardLoading}
                  >
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <span>
                    Target reward
                    <em>{getTargetRewardSubtext(rewardProgress)}</em>
                  </span>
                  {rewardProgress?.targetReached ? (
                    <span className="tag ok" data-testid="reward-target-reached">
                      Paid after month close
                    </span>
                  ) : (
                    <span className="tag n" data-testid="reward-target-progress">
                      {rewardProgress?.actual ?? 0} of {rewardProgress?.target ?? '—'}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Card: Payment history */}
        <div className="card sec" data-testid="payouts-card">
          <div
            className="ct"
            style={{
              padding: '16px 20px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <h3 style={{ margin: 0 }}>Payment history</h3>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {payouts.length} {payouts.length === 1 ? 'payment' : 'payments'} · {formatCurrency(earnings.paid, currency)} paid
            </span>
          </div>

          <div className="tablewrap" style={{ overflow: 'auto', paddingTop: 8 }}>
            <table className="pays" data-testid="payouts-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>For</th>
                </tr>
              </thead>
              <tbody>
                {payouts.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
                      No payment history yet.
                    </td>
                  </tr>
                ) : (
                  payouts.map((p) => (
                    <tr key={p.id} data-testid={`payout-row-${p.id}`}>
                      <td>{p.date ? formatDate(p.date) : '—'}</td>
                      <td className="num">
                        <b>{formatCurrency(p.amount, currency)}</b>
                      </td>
                      <td>
                        <span className="tag ok">
                          {p.status === 'completed' ? 'Paid' : p.status}
                        </span>
                      </td>
                      <td>{p.notes || p.reference || 'Commission payout'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Lines per order (base, upsell, reversal on returned order) */}
      <div className="card" style={{ marginTop: 16 }} data-testid="order-lines-card">
        <div
          className="ct"
          style={{
            padding: '16px 20px 8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 style={{ margin: 0 }}>Order earnings</h3>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {lines.length} {lines.length === 1 ? 'order' : 'orders'}
          </span>
        </div>

        <div className="tablewrap" style={{ overflow: 'auto' }}>
          <table className="pays" data-testid="order-lines-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Base</th>
                <th>Upsell</th>
                <th>Earned</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: 24 }}>
                    No order earnings yet.
                  </td>
                </tr>
              ) : (
                lines.map((line) => {
                  const orderNum = formatOrderNumber(line.orderId);
                  const statusLabel = getOrderStatusLabel(line.status);
                  return (
                    <tr key={line.orderId} data-testid={`order-line-${line.orderId}`}>
                      <td>
                        <b>{orderNum}</b>
                        {line.isReversal && (
                          <span
                            className="tag bad"
                            style={{ marginLeft: 8 }}
                            data-testid={`reversal-badge-${line.orderId}`}
                          >
                            Reversal {line.reversal ? `−${formatCurrency(line.reversal, currency)}` : ''}
                          </span>
                        )}
                      </td>
                      <td>{line.customerName || 'Customer'}</td>
                      <td>
                        <span className={`tag ${STATUS_TONE[line.status as OrderStatus] ?? 'n'}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="num">{formatCurrency(line.base, currency)}</td>
                      <td className="num">{formatCurrency(line.upsell, currency)}</td>
                      <td className="num">
                        <b>{formatCurrency(line.earned, currency)}</b>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </RepPageFrame>
  );
};

export default RepEarningsPage;
