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

export const RepEarningsPage: React.FC = () => {
  const [earnings, setEarnings] = useState<RepEarningsResult | null>(null);
  const [rewardProgress, setRewardProgress] = useState<RewardProgressResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [earningsRes, rewardRes] = await Promise.all([
        repService.getEarnings(),
        repService.getRewardProgress().catch(() => null),
      ]);
      setEarnings(earningsRes);
      setRewardProgress(rewardRes);
    } catch (err: any) {
      setError(err?.message || 'Could not load earnings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  if (loading && !earnings) {
    return (
      <section className="view on" id="earnings" aria-label="Earnings">
        <div className="head">
          <div>
            <h1>Earnings</h1>
            <p>What you are owed, what you were paid, and your target reward.</p>
          </div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p>Loading earnings...</p>
        </div>
      </section>
    );
  }

  if (error && !earnings) {
    return (
      <section className="view on" id="earnings" aria-label="Earnings">
        <div className="head">
          <div>
            <h1>Earnings</h1>
            <p>What you are owed, what you were paid, and your target reward.</p>
          </div>
        </div>
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <p style={{ color: 'var(--coral)', fontWeight: 600 }}>{error}</p>
          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => void loadData()}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  const currency = earnings?.currency || 'GHS';
  const isOverpaid = Boolean(earnings?.isOverpaid || (earnings?.owed && Number(earnings.owed) < 0));
  const overpaidAmount = earnings?.overpaid || (earnings?.owed ? String(Math.abs(Number(earnings.owed))) : '0.00');
  const owedAmount = earnings?.owed ?? '0.00';

  const overpaidDisplay = `Overpaid ${formatCurrency(overpaidAmount, currency)}`;
  const owedDisplay = isOverpaid ? overpaidDisplay : formatCurrency(owedAmount, currency);

  const lines = earnings?.lines ?? [];
  const payouts = earnings?.payouts ?? [];

  return (
    <section className="view on" id="earnings" aria-label="Earnings">
      <div className="head">
        <div>
          <h1>Earnings</h1>
          <p>What you are owed, what you were paid, and your target reward.</p>
        </div>
      </div>

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
              <b className="num">{formatCurrency(earnings?.commission ?? '0.00', currency)}</b>
            </div>

            <div className="li" data-testid="line-upsell">
              <span>
                Upsell reward
                <em>10% of extra value on delivered orders</em>
              </span>
              <b className="num">{formatCurrency(earnings?.upsellReward ?? '0.00', currency)}</b>
            </div>

            <div className="li" data-testid="line-paid">
              <span>
                Paid
                <em>Payouts made</em>
              </span>
              <b className="num">
                {Number(earnings?.paid ?? 0) > 0 ? `− ${formatCurrency(earnings?.paid, currency)}` : formatCurrency('0.00', currency)}
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

          {earnings?.openOrdersNote && (
            <div className="note1" data-testid="open-orders-note">
              <Info size={16} />
              <span>{earnings.openOrdersNote}</span>
            </div>
          )}

          <div className="lines" style={{ paddingTop: 0 }}>
            <div className="li" data-testid="reward-progress-line">
              <span>
                Target reward
                <em>
                  {rewardProgress?.target
                    ? `GH₵${rewardProgress.reward?.amount || '300'} at ${rewardProgress.target} confirmed and delivered (100%)`
                    : 'No target set'}
                </em>
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
              {payouts.length} {payouts.length === 1 ? 'payment' : 'payments'} · {formatCurrency(earnings?.paid ?? '0.00', currency)} paid
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
    </section>
  );
};

export default RepEarningsPage;
