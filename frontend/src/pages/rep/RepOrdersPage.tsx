import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Phone, ChevronRight, ChevronLeft } from 'lucide-react';
import clsx from 'clsx';
import { repService, type RepOrderRow, type RepOrdersResult } from '../../services/rep.service';
import { formatOrderNumber } from '../../utils/orderNumber';
import { getOrderStatusLabel } from '../../utils/orderStatus';
import { formatCurrency, formatDate } from '../../utils/format';
import { normalizePhone } from '../../utils/phone';
import { personName } from '../../utils/people';
import { CallCard } from '../../components/rep/CallCard';
import { STATUS_TONE } from '../orders/model';
import type { OrderStatus } from '../../types';
import { RepPageFrame } from './RepPageFrame';
import { REP_PANEL_BREAKPOINT } from './queueHelpers';
import { WhatsAppButton } from '../../components/rep/WhatsAppButton';

/**
 * My orders tabs. Mirrors REP_ORDER_GROUPS in backend/src/services/repService.ts: the API filters
 * by `group`. pending_confirmation lives in the Queue and shows in neither tab.
 * Statuses: in_progress = payment_pending, confirmed, preparing, ready_for_pickup, out_for_delivery, payment_failed;
 * finished = delivered, digital_delivered, cancelled, returned, failed_delivery.
 */
type OrdersTab = 'in_progress' | 'finished';
const TABS: { key: OrdersTab; label: string; empty: string }[] = [
  { key: 'in_progress', label: 'In progress', empty: 'No orders in progress.' },
  { key: 'finished', label: 'Finished', empty: 'No finished orders yet.' },
];

export const RepOrdersPage: React.FC = () => {
  const [ordersData, setOrdersData] = useState<RepOrdersResult | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<OrdersTab>('in_progress');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOrders = useCallback(async (q: string, group: OrdersTab, pageNum: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await repService.getOrders({
        q: q.trim() || undefined,
        group,
        page: pageNum,
        limit: 25,
      });
      setOrdersData(data);

      // Auto-select first order on desktop if none selected
      if (data.orders.length > 0) {
        setSelectedOrderId((prev) => {
          if (prev && data.orders.some((o) => o.id === prev)) return prev;
          if (window.innerWidth > REP_PANEL_BREAKPOINT) return data.orders[0].id;
          return null;
        });
      } else {
        setSelectedOrderId(null);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrders(searchQuery, tab, page);
  }, [tab, page, fetchOrders]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
      void fetchOrders(val, tab, 1);
    }, 300);
  };

  const handleTabChange = (key: OrdersTab) => {
    if (key === tab) return;
    setTab(key);
    setPage(1);
  };

  const orders = ordersData?.orders ?? [];
  const pagination = ordersData?.pagination;

  return (
    <RepPageFrame
      id="orders"
      ariaLabel="My orders"
      title="My orders"
      subtitle="Orders after the call: on the way and finished."
    >
      <div className="work">
        <div className="card" id="ocard">
          <div className="qtabs" data-testid="orders-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                data-testid={`orders-tab-${t.key}`}
                className={clsx('tab', tab === t.key && 'on')}
                onClick={() => handleTabChange(t.key)}
              >
                <span>{t.label}</span>
                {tab === t.key && pagination && (
                  <span className="pill" data-testid={`orders-tab-count-${t.key}`}>
                    {pagination.total}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="filter-bar">
            <label className="find" style={{ flex: 1, margin: 0 }}>
              <Search size={16} />
              <input
                id="oq"
                type="text"
                placeholder="Name, phone or order #"
                aria-label="Search my orders"
                value={searchQuery}
                onChange={handleSearchChange}
              />
            </label>
          </div>

          <div className="qlist" id="olist">
            {loading && !ordersData ? (
              <div className="empty">
                <p>Loading orders...</p>
              </div>
            ) : error ? (
              <div className="empty">
                <p style={{ color: 'var(--coral)', fontWeight: 600 }}>{error}</p>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 12 }}
                  onClick={() => void fetchOrders(searchQuery, tab, page)}
                >
                  Try again
                </button>
              </div>
            ) : orders.length === 0 ? (
              <div className="empty" data-testid="orders-empty">
                <p style={{ fontWeight: 600 }}>Nothing here</p>
                <p className="sub">
                  {searchQuery ? 'No orders match your search.' : TABS.find((t) => t.key === tab)!.empty}
                </p>
              </div>
            ) : (
              orders.map((o) => {
                const customerName = o.customer ? personName(o.customer) || 'Customer' : 'Customer';
                const statusLabel = getOrderStatusLabel(o.status);
                const orderNum = formatOrderNumber(o.id);
                const area = o.customer?.area || o.customer?.state || '';
                const itemsSummary = o.items.length > 0
                  ? o.items.map((i) => `${i.quantity} × ${i.productName}`).join(', ')
                  : 'Items';

                const phone = o.customer?.phone;
                const normalized = phone ? normalizePhone(phone) : null;
                const telUrl = normalized ? `tel:${normalized}` : undefined;

                return (
                  <div
                    key={o.id}
                    data-testid={`order-row-${o.id}`}
                    className={clsx('qi', selectedOrderId === o.id && 'sel')}
                    onClick={() => setSelectedOrderId(o.id)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open order ${o.id}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedOrderId(o.id);
                      }
                    }}
                  >
                    <div className="wt">
                      <small>{orderNum}</small>
                      <b style={{ fontSize: 12.5 }}>{formatDate(o.createdAt, 'd MMM')}</b>
                    </div>

                    <div className="qm">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <b>{customerName}</b>
                        <span
                          className={`tag ${STATUS_TONE[o.status as OrderStatus] ?? 'n'}`}
                          style={{ fontSize: 11 }}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <small>
                        {area ? `${area} · ` : ''}
                        {formatCurrency(o.totalAmount)} · {itemsSummary}
                      </small>
                    </div>

                    <div className="qa" onClick={(e) => e.stopPropagation()}>
                      {telUrl && (
                        <a
                          className="ibtn call"
                          href={telUrl}
                          aria-label={`Call ${customerName}`}
                          data-testid={`call-btn-${o.id}`}
                        >
                          <Phone size={15} />
                        </a>
                      )}
                      {normalized && (
                        <WhatsAppButton orderId={o.id} customerName={customerName} className="ibtn" testId={`wa-btn-${o.id}`} />
                      )}
                      <button
                        type="button"
                        className="ibtn"
                        aria-label={`Open order ${o.id}`}
                        onClick={() => setSelectedOrderId(o.id)}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="pagination" data-testid="orders-pagination">
              <button
                type="button"
                className="btn"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <span>
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} orders)
              </span>
              <button
                type="button"
                className="btn"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        <div
          className={clsx('card callpanel', selectedOrderId && 'open')}
          id="opanel"
          aria-label="Order details"
        >
          {selectedOrderId ? (
            <CallCard
              key={selectedOrderId}
              orderId={selectedOrderId}
              readOnly={true}
              onBack={() => setSelectedOrderId(null)}
            />
          ) : (
            <div className="empty" style={{ padding: 40 }} data-testid="opanel-empty">
              <p style={{ fontWeight: 600 }}>Select an order</p>
              <p className="sub">Pick an order from the list to view its details.</p>
            </div>
          )}
        </div>
      </div>
    </RepPageFrame>
  );
};

export default RepOrdersPage;
