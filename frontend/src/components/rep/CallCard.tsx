import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  MessageCircle,
  MessagesSquare,
  Pencil,
  Phone,
  PhoneMissed,
  Save,
  UserX,
  XCircle,
} from 'lucide-react';
import { Button, Skeleton, Tag, useToast } from '../ui-v2';
import { CustomerModal } from '../../pages/customers/CustomerModal';
import { repService, type CallCardData } from '../../services/rep.service';
import { callsService } from '../../services/calls.service';
import { formatCurrency, formatDate, formatPhoneLocal } from '../../utils/format';
import { orderNumber, shortDate, STATUS_TONE } from '../../pages/orders/model';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { toCents } from '../../utils/money';
import { CallOutcome, type DeclineReason, type OrderStatus } from '../../types';
import '../../styles/callCard.css';

export interface CallCardProps {
  orderId: number;
  onDone: (nextOrderId: number | null) => void;
  onBack?: () => void;
}

type OutcomeId = 'confirmed' | 'not_reachable' | 'call_back_later' | 'declined' | 'wrong_number';

const CB_TIME_CHIPS = ['In 30 min', 'In 1 hour', 'Today 16:00', 'Tomorrow 09:00'] as const;

const DECLINE_REASONS: Array<{ id: DeclineReason; label: string }> = [
  { id: 'price_too_high', label: 'Price too high' },
  { id: 'prank_or_mistake', label: 'Prank or ordered by mistake' },
  { id: 'changed_mind', label: 'Changed mind' },
  { id: 'bought_elsewhere', label: 'Bought elsewhere' },
  { id: 'other', label: 'Other' },
];

const OUTCOME_LABELS: Record<OutcomeId, string> = {
  confirmed: 'Save as confirmed',
  not_reachable: 'Save, not reachable',
  call_back_later: 'Save call back',
  declined: 'Save as declined',
  wrong_number: 'Save, wrong number',
};

function computeChipDate(chip: (typeof CB_TIME_CHIPS)[number], baseTime: number): Date {
  const d = new Date(baseTime);
  if (chip === 'In 30 min') {
    return new Date(baseTime + 30 * 60 * 1000);
  }
  if (chip === 'In 1 hour') {
    return new Date(baseTime + 60 * 60 * 1000);
  }
  if (chip === 'Today 16:00') {
    d.setHours(16, 0, 0, 0);
    return d;
  }
  if (chip === 'Tomorrow 09:00') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  return d;
}

export function CallCard({ orderId, onDone, onBack }: CallCardProps) {
  const say = useToast();
  const [card, setCard] = useState<CallCardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<Date>(() => new Date());

  // Outcome selection state
  const [outcome, setOutcome] = useState<OutcomeId | null>(null);
  const [cbChip, setCbChip] = useState<(typeof CB_TIME_CHIPS)[number] | null>(null);
  const [customCbTime, setCustomCbTime] = useState<string>('');
  const [declineReason, setDeclineReason] = useState<DeclineReason | null>(null);
  const [declineNote, setDeclineNote] = useState('');
  const [callNote, setCallNote] = useState('');
  const [callLength, setCallLength] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Upsell state (for T18)
  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<Set<number>>(new Set());

  // Customer edit modal (T20)
  const [editingCustomer, setEditingCustomer] = useState(false);

  const loadCard = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const data = await repService.getCallCard(orderId);
        setCard(data);
        setError(null);
        if (!quiet) setConflictError(null);
        setStartedAt(new Date());

        // Initialize upsell selection from current package
        if (data.packages?.currentPackage?.id != null) {
          setSelectedPackageId(data.packages.currentPackage.id);
        } else if (data.packages?.availablePackages?.length) {
          const defaultPkg = data.packages.availablePackages.find((p) => p.isDefault) ?? data.packages.availablePackages[0];
          setSelectedPackageId(defaultPkg?.id ?? null);
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          setError('Order not found');
        } else if (axios.isAxiosError(err) && err.response?.status === 403) {
          setError("You cannot view another rep's order");
        } else {
          setError('Failed to load call card');
        }
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [orderId],
  );

  useEffect(() => {
    setOutcome(null);
    setCbChip(null);
    setCustomCbTime('');
    setDeclineReason(null);
    setDeclineNote('');
    setCallNote('');
    setCallLength('');
    setSelectedAddonIds(new Set());
    void loadCard(false);
  }, [loadCard]);

  const isPending = card?.order.status === 'pending_confirmation';

  // Call back time calculation & validation
  const { callbackDate, isPastCallback } = useMemo(() => {
    if (outcome !== 'call_back_later') return { callbackDate: null, isPastCallback: false };

    let targetDate: Date | null = null;
    const now = Date.now();

    if (cbChip) {
      targetDate = computeChipDate(cbChip, now);
    } else if (customCbTime) {
      const [h, m] = customCbTime.split(':').map(Number);
      if (!Number.isNaN(h) && !Number.isNaN(m)) {
        targetDate = new Date();
        targetDate.setHours(h, m, 0, 0);
      }
    }

    if (!targetDate) return { callbackDate: null, isPastCallback: false };
    const isPast = targetDate.getTime() <= now;
    return { callbackDate: targetDate, isPastCallback: isPast };
  }, [outcome, cbChip, customCbTime]);

  // Upsell calculation
  const { liveTotal, extraValueCents, rewardCents } = useMemo(() => {
    if (!card) return { liveTotal: 0, extraValueCents: 0, rewardCents: 0 };
    const baseCents = toCents(card.order.totalAmount);
    if (!card.packages?.availablePackages?.length) {
      return { liveTotal: baseCents / 100, extraValueCents: 0, rewardCents: 0 };
    }

    const currentPkg = card.packages.availablePackages.find((p) => p.id === card.packages.currentPackage.id);
    const selectedPkg = card.packages.availablePackages.find((p) => p.id === selectedPackageId);

    const basePkgCents = currentPkg ? toCents(currentPkg.price) : toCents(card.packages.currentPackage.price);
    const selectedPkgCents = selectedPkg ? toCents(selectedPkg.price) : basePkgCents;
    const pkgDiffCents = Math.max(0, selectedPkgCents - basePkgCents);

    let addonsCents = 0;
    if (card.packages.availableAddons) {
      for (const addon of card.packages.availableAddons) {
        if (selectedAddonIds.has(addon.id)) {
          addonsCents += toCents(addon.price);
        }
      }
    }

    const extraTotalCents = pkgDiffCents + addonsCents;
    const totalCents = baseCents + extraTotalCents;
    const calculatedRewardCents = Math.round((extraTotalCents * card.pay.upsellPercent) / 100);

    return {
      liveTotal: totalCents / 100,
      extraValueCents: extraTotalCents,
      rewardCents: calculatedRewardCents,
    };
  }, [card, selectedPackageId, selectedAddonIds]);

  // Save button enabled check
  const canSave = useMemo(() => {
    if (!card || !isPending || !outcome || saving) return false;

    if (outcome === 'call_back_later') {
      if (!callbackDate || isPastCallback) return false;
    }

    if (outcome === 'declined') {
      if (!declineReason) return false;
      if (declineReason === 'other' && !declineNote.trim()) return false;
    }

    return true;
  }, [card, isPending, outcome, saving, callbackDate, isPastCallback, declineReason, declineNote]);

  const handleSave = async () => {
    if (!card || !outcome || !canSave) return;
    setSaving(true);
    setConflictError(null);

    try {
      const fullNotes = [
        callNote.trim(),
        outcome === 'declined' && declineReason === 'other' && declineNote.trim() ? `Decline reason (other): ${declineNote.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const orderChanges =
        outcome === 'confirmed'
          ? {
              packageId: selectedPackageId,
              addOnIds: Array.from(selectedAddonIds),
            }
          : undefined;

      const res = await callsService.createCall({
        customerId: card.customer.id,
        orderId: card.order.id,
        outcome: outcome as CallOutcome,
        duration: callLength ? parseInt(callLength, 10) : undefined,
        notes: fullNotes || undefined,
        startedAt: startedAt.toISOString(),
        expectedUpdatedAt: card.order.updatedAt,
        callbackAt: callbackDate ? callbackDate.toISOString() : undefined,
        declineReason: outcome === 'declined' && declineReason ? declineReason : undefined,
        orderChanges,
      });

      // Toast feedback
      if (outcome === 'confirmed') {
        const baseMoney = formatCurrency(card.pay.baseCommission);
        const extraReward = res.upsell?.estimatedReward;
        const hasExtra = extraReward != null && toCents(extraReward) > 0;
        if (hasExtra) {
          say(`${baseMoney} plus ${formatCurrency(extraReward)} if delivered`);
        } else {
          say(`You earn ${baseMoney} if delivered`);
        }
      } else if (outcome === 'not_reachable') {
        say('Call saved: not reachable');
      } else if (outcome === 'call_back_later') {
        say(callbackDate ? `Call back set for ${formatDate(callbackDate, 'HH:mm')}` : 'Call back set');
      } else if (outcome === 'declined') {
        say('Call saved: declined');
      } else if (outcome === 'wrong_number') {
        say('Call saved: wrong number');
      }

      onDone(res.nextOrderId ?? null);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : (err as any)?.response?.status;
      if (status === 409) {
        setConflictError('Already handled');
        say('Already handled');
        await loadCard(true);
      } else {
        say(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed to save call' : 'Failed to save call');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="call-card" aria-busy="true" aria-label="Loading call card">
        <div className="cc-head">
          <Skeleton height={32} width={180} />
          <Skeleton height={20} width={120} />
        </div>
        <div className="blk">
          <Skeleton height={100} />
        </div>
        <div className="blk">
          <Skeleton height={140} />
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="call-card">
        <div className="blk" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <AlertTriangle aria-hidden="true" style={{ width: 36, height: 36, margin: '0 auto 12px', color: 'var(--coral)' }} />
          <h3>{error ?? 'Could not load order'}</h3>
          <Button onClick={() => void loadCard()} style={{ marginTop: 12 }}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const tel = card.customer.phoneNumber.replace(/\s+/g, '');
  const waDigits = card.customer.phoneNumber.replace(/\D/g, '');
  const redeliveryCtx =
    card.order.status === 'failed_delivery' || card.order.failureReason
      ? card.lastCalls.find((c) => c.notes)?.notes || card.order.notes || 'Delivery failed on previous attempt.'
      : null;

  return (
    <div className="call-card" data-testid="call-card">
      <div className="cc-top">
        <div className="cc-head">
          {onBack && (
            <button type="button" className="backm" onClick={onBack} aria-label="Back to queue">
              <ArrowLeft aria-hidden="true" style={{ width: 18, height: 18 }} />
            </button>
          )}
          <div>
            <h2>{card.customer.name}</h2>
            <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
              <span>{orderNumber(card.order.id)}</span>
              <span>·</span>
              <span>{card.customer.area || card.customer.state || 'Accra'}</span>
              <Tag tone={STATUS_TONE[card.order.status as OrderStatus] ?? 'warn'}>
                {ORDER_STATUS_LABELS[card.order.status as OrderStatus] ?? card.order.status}
              </Tag>
            </div>
          </div>
          <div className="cc-val">
            <small>Order value</small>
            <div className="num" data-testid="cc-val">
              {formatCurrency(liveTotal)}
            </div>
          </div>
        </div>
      </div>

      {conflictError && (
        <div className="alert-handled" role="alert">
          {conflictError}
        </div>
      )}

      {!isPending && (
        <div className="alert-notpending" role="status">
          Order is {ORDER_STATUS_LABELS[card.order.status as OrderStatus] ?? card.order.status}. Outcome buttons disabled.
        </div>
      )}

      {/* Action buttons */}
      <div className="acts">
        <a className="pri" href={`tel:${tel}`} aria-label={`Call ${card.customer.name}`}>
          <Phone aria-hidden="true" style={{ width: 15, height: 15 }} /> Call
        </a>
        <a href={`https://wa.me/${waDigits}`} aria-label={`WhatsApp ${card.customer.name}`}>
          <MessageCircle aria-hidden="true" style={{ width: 15, height: 15 }} /> WhatsApp
        </a>
        <button type="button" disabled title="Team notes arrive with Inbox">
          <MessagesSquare aria-hidden="true" style={{ width: 15, height: 15 }} /> Team notes
        </button>
      </div>

      {/* Re-delivery hint */}
      {redeliveryCtx && (
        <div className="blk" style={{ borderTop: 0, paddingTop: 0 }}>
          <div className="hint redelivery-hint">
            <b>Re-delivery call.</b> {redeliveryCtx} Ask when the customer can receive the order.
          </div>
        </div>
      )}

      {/* Customer block */}
      <div className="blk">
        <div className="blk-header">
          <h4>Customer</h4>
          <Button size="mini" onClick={() => setEditingCustomer(true)}>
            <Pencil aria-hidden="true" style={{ width: 12, height: 12 }} /> Edit
          </Button>
        </div>
        <dl className="kv">
          <dt>Phone</dt>
          <dd>
            {formatPhoneLocal(card.customer.phoneNumber)}
            {card.customer.alternatePhone ? ` · alt ${formatPhoneLocal(card.customer.alternatePhone)}` : ''}
          </dd>
          {card.customer.email && (
            <>
              <dt>Email</dt>
              <dd>{card.customer.email}</dd>
            </>
          )}
          <dt>Address</dt>
          <dd>{card.customer.address || '—'}</dd>
          <dt>Payment</dt>
          <dd>Cash on delivery · unpaid</dd>
          <dt>Assigned</dt>
          <dd>
            Call rep {card.order.customerRep?.name ?? 'Adwoa Darko'}
            {card.order.deliveryAgent ? ` · Delivery ${card.order.deliveryAgent.name}` : ' · Delivery agent not set yet'}
          </dd>
          {(card.customer.refusedOrders > 0 || card.customer.riskLevel === 'high' || card.customer.codBlocked || card.customer.wrongNumber) && (
            <>
              <dt>Risk</dt>
              <dd style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {card.customer.refusedOrders >= 2 && <Tag tone="bad">High risk</Tag>}
                {card.customer.refusedOrders > 0 && <Tag tone="bad">Refused {card.customer.refusedOrders}</Tag>}
                {card.customer.codBlocked && <Tag tone="bad">COD off</Tag>}
                {card.customer.wrongNumber && <Tag tone="bad">Wrong number</Tag>}
              </dd>
            </>
          )}
        </dl>
      </div>

      {/* Order block */}
      <div className="blk">
        <h4>Order</h4>
        <div>
          {card.items.map((item) => (
            <div className="li" key={item.id}>
              <span>
                {item.quantity} × {item.productName}
              </span>
              <b className="num">{formatCurrency(item.totalPrice)}</b>
            </div>
          ))}
          {extraValueCents > 0 && (
            <div className="li" style={{ color: 'var(--pine)' }}>
              <span>Upsell changes</span>
              <b className="num">+ {formatCurrency(extraValueCents / 100)}</b>
            </div>
          )}
          <div className="li tot">
            <b>Cash to collect</b>
            <b className="num" data-testid="cash-to-collect">
              {formatCurrency(liveTotal)}
            </b>
          </div>
        </div>
      </div>

      {/* Previous orders */}
      <div className="blk">
        <h4>Previous orders</h4>
        {card.customer.previousOrders.length > 0 ? (
          card.customer.previousOrders.map((po) => (
            <div className="li" key={po.id}>
              <span>
                {shortDate(po.createdAt)} · {formatCurrency(po.totalAmount)}
              </span>
              <Tag tone={po.status === 'delivered' ? 'ok' : 'bad'}>
                {po.status === 'delivered' ? 'Delivered' : 'Failed'}
              </Tag>
            </div>
          ))
        ) : (
          <p className="sub" style={{ margin: '4px 0 0' }}>
            First order from this customer.
          </p>
        )}
      </div>

      {/* Call history */}
      <div className="blk">
        <h4>Call history</h4>
        {card.lastCalls.length > 0 ? (
          <div className="hist">
            {card.lastCalls.map((h) => (
              <div className="hi" key={h.id}>
                <Tag tone={h.outcome === 'confirmed' ? 'ok' : h.outcome === 'declined' || h.outcome === 'wrong_number' ? 'bad' : 'warn'}>
                  {h.outcome.replace(/_/g, ' ')}
                </Tag>
                <div>
                  <small>
                    {shortDate(h.createdAt || h.startedAt || '')} · {h.salesRep?.name ?? 'Rep'}
                    {h.duration ? ` · ${Math.floor(h.duration / 60)}:${String(h.duration % 60).padStart(2, '0')} min` : ''}
                  </small>
                  {h.notes && <p>{h.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="sub" style={{ margin: '4px 0 0' }}>
            No calls yet.
          </p>
        )}
      </div>

      {/* How did the call go? */}
      <div className="blk">
        <h4>How did the call go?</h4>
        <div className="outs" role="group" aria-label="Call outcomes">
          <button
            type="button"
            className={outcome === 'confirmed' ? 'on' : ''}
            disabled={!isPending}
            onClick={() => setOutcome('confirmed')}
            aria-pressed={outcome === 'confirmed'}
          >
            <CheckCircle2 aria-hidden="true" style={{ width: 18, height: 18 }} />
            Confirmed
          </button>
          <button
            type="button"
            className={outcome === 'not_reachable' ? 'on' : ''}
            disabled={!isPending}
            onClick={() => setOutcome('not_reachable')}
            aria-pressed={outcome === 'not_reachable'}
          >
            <PhoneMissed aria-hidden="true" style={{ width: 18, height: 18 }} />
            Not reachable
          </button>
          <button
            type="button"
            className={outcome === 'call_back_later' ? 'on' : ''}
            disabled={!isPending}
            onClick={() => setOutcome('call_back_later')}
            aria-pressed={outcome === 'call_back_later'}
          >
            <Clock aria-hidden="true" style={{ width: 18, height: 18 }} />
            Call back later
          </button>
          <button
            type="button"
            className={`bad ${outcome === 'declined' ? 'on' : ''}`}
            disabled={!isPending}
            onClick={() => setOutcome('declined')}
            aria-pressed={outcome === 'declined'}
          >
            <XCircle aria-hidden="true" style={{ width: 18, height: 18 }} />
            Declined
          </button>
          <button
            type="button"
            className={`bad ${outcome === 'wrong_number' ? 'on' : ''}`}
            disabled={!isPending}
            onClick={() => setOutcome('wrong_number')}
            aria-pressed={outcome === 'wrong_number'}
          >
            <UserX aria-hidden="true" style={{ width: 18, height: 18 }} />
            Wrong number
          </button>
        </div>

        {/* Sub panels per outcome */}
        {outcome === 'confirmed' && (
          <div style={{ marginTop: 14 }}>
            {card.packages?.availablePackages?.length ? (
              <div className="ups">
                <h5>Change the order (optional)</h5>
                <p className="sub" style={{ margin: '2px 0 10px' }}>
                  Offer more only when it helps the customer. Skip this if they are happy.
                </p>

                {card.packages.availablePackages.map((pkg) => {
                  const isSel = selectedPackageId === pkg.id;
                  return (
                    <button
                      type="button"
                      key={pkg.id}
                      className={`opt ${isSel ? 'on' : ''}`}
                      onClick={() => setSelectedPackageId(pkg.id)}
                    >
                      <span className="rd">
                        {isSel && <CheckCircle2 aria-hidden="true" style={{ width: 14, height: 14 }} />}
                      </span>
                      <span>{pkg.name}</span>
                      <span className="pr">{formatCurrency(pkg.price)}</span>
                    </button>
                  );
                })}

                {card.packages.availableAddons?.length > 0 && (
                  <>
                    <p style={{ margin: '14px 0 6px', fontWeight: 600, fontSize: 13, color: 'var(--ink-3)' }}>Add-ons</p>
                    {card.packages.availableAddons.map((addon) => {
                      const isSel = selectedAddonIds.has(addon.id);
                      return (
                        <button
                          type="button"
                          key={addon.id}
                          className={`opt ${isSel ? 'on' : ''}`}
                          onClick={() => {
                            setSelectedAddonIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(addon.id)) next.delete(addon.id);
                              else next.add(addon.id);
                              return next;
                            });
                          }}
                        >
                          <span className="rd ck">
                            {isSel && <CheckCircle2 aria-hidden="true" style={{ width: 14, height: 14 }} />}
                          </span>
                          <span>{addon.name}</span>
                          <span className="pr">+ {formatCurrency(addon.price)}</span>
                        </button>
                      );
                    })}
                  </>
                )}

                <div className={`earnbox ${extraValueCents > 0 ? '' : 'none'}`} data-testid="earnbox">
                  <span>
                    {extraValueCents > 0
                      ? `You earn ${formatCurrency(rewardCents / 100)} extra if this order is delivered (${card.pay.upsellPercent}% of ${formatCurrency(extraValueCents / 100)})`
                      : `No extra value added. You still earn ${formatCurrency(card.pay.baseCommission)} if it is delivered.`}
                  </span>
                </div>
              </div>
            ) : (
              <div className="hint">No package changes available for this order.</div>
            )}
          </div>
        )}

        {outcome === 'not_reachable' && (
          <div style={{ marginTop: 12 }}>
            <div className="hint">Logs this attempt. The order stays in your queue.</div>
          </div>
        )}

        {outcome === 'call_back_later' && (
          <div style={{ marginTop: 12 }}>
            <div className="fld">
              <label>When should you call?</label>
              <div className="chips" role="group" aria-label="Call back chips">
                {CB_TIME_CHIPS.map((chip) => (
                  <button
                    type="button"
                    key={chip}
                    className={cbChip === chip ? 'on' : ''}
                    onClick={() => {
                      setCbChip(chip);
                      setCustomCbTime('');
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
            <div className="fld" style={{ marginTop: 10, maxWidth: 200 }}>
              <label htmlFor="custom-cb-time">Or pick a time</label>
              <input
                id="custom-cb-time"
                type="time"
                value={customCbTime}
                onChange={(e) => {
                  setCustomCbTime(e.target.value);
                  setCbChip(null);
                }}
              />
            </div>
            {isPastCallback && (
              <p style={{ color: 'var(--coral)', fontSize: 13, marginTop: 6, fontWeight: 600 }} role="alert">
                Call-back time cannot be in the past
              </p>
            )}
          </div>
        )}

        {outcome === 'declined' && (
          <div style={{ marginTop: 12 }}>
            <div className="fld">
              <label>Why did the customer decline?</label>
              <div className="chips" role="group" aria-label="Decline reason chips">
                {DECLINE_REASONS.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={declineReason === r.id ? 'on' : ''}
                    onClick={() => setDeclineReason(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            {declineReason === 'other' && (
              <div className="fld" style={{ marginTop: 10 }}>
                <label htmlFor="decline-note">Reason note (required)</label>
                <input
                  id="decline-note"
                  placeholder="Why did they decline?"
                  value={declineNote}
                  onChange={(e) => setDeclineNote(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {outcome === 'wrong_number' && (
          <div style={{ marginTop: 12 }}>
            <div className="hint">
              Marks this number as wrong. Put the correct number in the note if the customer gave one.
            </div>
          </div>
        )}
      </div>

      {/* Notes and length */}
      <div className="blk">
        <div className="fl2">
          <div className="fld">
            <label htmlFor="call-card-note">Call note</label>
            <textarea
              id="call-card-note"
              rows={2}
              placeholder="What did the customer say?"
              value={callNote}
              onChange={(e) => setCallNote(e.target.value)}
            />
          </div>
          <div className="fld">
            <label htmlFor="call-card-length">Call length (sec)</label>
            <input
              id="call-card-length"
              type="number"
              placeholder="Optional"
              value={callLength}
              onChange={(e) => setCallLength(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="save">
        <button
          type="button"
          className="btn-save"
          disabled={!canSave}
          onClick={() => void handleSave()}
          aria-label={outcome ? OUTCOME_LABELS[outcome] : 'Pick an outcome'}
        >
          <Save aria-hidden="true" style={{ width: 16, height: 16 }} />
          <span>{outcome ? OUTCOME_LABELS[outcome] : 'Pick an outcome'}</span>
        </button>
      </div>

      {/* Customer Modal for edit */}
      <CustomerModal
        open={editingCustomer}
        onClose={() => setEditingCustomer(false)}
        customer={{
          id: card.customer.id,
          firstName: card.customer.firstName,
          lastName: card.customer.lastName,
          phoneNumber: card.customer.phoneNumber,
          alternatePhone: card.customer.alternatePhone ?? null,
          email: card.customer.email ?? null,
          address: card.customer.address ?? '',
          state: card.customer.state || '',
          area: card.customer.area || '',
          landmark: null,
          notes: null,
          totalOrders: card.customer.previousOrders?.length ?? 0,
          deliveredOrders: card.customer.deliveredOrders ?? 0,
          refusedOrders: card.customer.refusedOrders ?? 0,
          risk: (card.customer.riskLevel as any) || 'low',
          notReachable: false,
          codBlocked: card.customer.codBlocked,
          deliveredValue: 0,
          lastOrderAt: null,
          smsOptOut: false,
          whatsappOptOut: false,
          emailOptOut: false,
          isActive: true,
          createdAt: new Date().toISOString(),
        }}
        onSaved={(_name) => {
          setEditingCustomer(false);
          void loadCard(true);
        }}
      />
    </div>
  );
}
