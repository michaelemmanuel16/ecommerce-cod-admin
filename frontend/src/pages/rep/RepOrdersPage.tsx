import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Phone, MessageCircle, ChevronRight, ChevronLeft } from 'lucide-react';
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

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'confirmed,preparing,ready_for_pickup', label: 'Waiting to dispatch' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed_delivery,returned', label: 'Failed or returned' },
  { value: 'cancelled', label: getOrderStatusLabel('cancelled') },
];

export const RepOrdersPage: React.FC = () => {
  const [ordersData, setOrdersData] = useState<RepOrdersResult | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOrders = useCallback(async (q: string, status: string, pageNum: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await repService.getOrders({
        q: q.trim() || undefined,
        status: status === 'all' ? undefined : status,
        page: pageNum,
        limit: 25,
      });
      setOrdersData(data);

      // Auto-select first order on desktop if none selected
      if (data.orders.length > 0) {
        setSelectedOrderId((prev) => {
          if (prev && data.orders.some((o) => o.id === prev)) return prev;
          if (window.innerWidth > 1100) return data.orders[0].id;
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
    void fetchOrders(searchQuery, statusFilter, page);
  }, [statusFilter, page, fetchOrders]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
      void fetchOrders(val, statusFilter, 1);
    }, 300);
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStatusFilter(e.target.value);
    setPage(1);
  };

  const orders = ordersData?.orders ?? [];
  const pagination = ordersData?.pagination;

  return (
    <section className="view on" id="orders" aria-label="My orders">
      <div className="head">
        <div>
          <h1>My orders</h1>
          <p>Every order assigned to you, with its status.</p>
        </div>
      </div>

      <div className="work">
        <div className="card" id="ocard">
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
            <select
              className="status-select"
              aria-label="Filter orders by status"
              value={statusFilter}
              onChange={handleStatusChange}
              data-testid="orders-status-filter"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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
                  onClick={() => void fetchOrders(searchQuery, statusFilter, page)}
                >
                  Try again
                </button>
              </div>
            ) : orders.length === 0 ? (
              <div className="empty" data-testid="orders-empty">
                <p style={{ fontWeight: 600 }}>Nothing here</p>
                <p className="sub">
                  {searchQuery ? 'No orders match your search.' : 'You have no assigned orders yet.'}
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
                const cleanDigits = normalized ? normalized.replace(/\D/g, '') : '';
                const waUrl = cleanDigits ? `https://wa.me/${cleanDigits}` : undefined;

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
                      {waUrl && (
                        <a
                          className="ibtn"
                          href={waUrl}
                          aria-label={`WhatsApp ${customerName}`}
                          data-testid={`wa-btn-${o.id}`}
                        >
                          <MessageCircle size={15} />
                        </a>
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
    </section>
  );
};

export default RepOrdersPage;
