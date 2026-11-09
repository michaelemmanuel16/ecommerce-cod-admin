import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Plus, Search, Phone, MessageCircle } from 'lucide-react';
import { repService, type QueueResult, type QueueItem } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { normalizePhone } from '../../utils/phone';
import { QueueCallPanel } from './QueueCallPanel';
import { NewOrderSheet } from '../orders/NewOrderSheet';
import { formatWaitDuration, formatCallbackTime } from './queueHelpers';

type QueueTab = 'new' | 'call_back' | 'said_no' | 'not_reachable';

const REFETCH_EVENTS = [
  'order:created',
  'order:updated',
  'order:assigned',
  'order:status_changed',
];

export const RepQueuePage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<QueueTab>('new');
  const [searchQuery, setSearchQuery] = useState('');
  const [queueData, setQueueData] = useState<QueueResult | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Time tracking for live ticker
  const [fetchTime, setFetchTime] = useState<number>(Date.now());
  const [now, setNow] = useState<number>(Date.now());

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchQueue = useCallback(async (tab: QueueTab, q?: string) => {
    try {
      setLoading(true);
      const data = await repService.getQueue(tab, q);
      setQueueData(data);
      const timestamp = Date.now();
      setFetchTime(timestamp);
      setNow(timestamp);

      // Auto-select first order if none selected or previous selection no longer in list
      if (data.orders.length > 0) {
        setSelectedOrderId((prev) => {
          if (prev && data.orders.some((o) => o.id === prev)) return prev;
          return data.orders[0].id;
        });
      } else {
        setSelectedOrderId(null);
      }
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on tab change
  useEffect(() => {
    void fetchQueue(activeTab, searchQuery);
  }, [activeTab, fetchQueue]);

  // Periodic refresh & live ticking timer
  useEffect(() => {
    // Live ticking every 10 seconds
    const tickTimer = setInterval(() => {
      setNow(Date.now());
    }, 10000);

    // Full queue reload every 60 seconds
    const reloadTimer = setInterval(() => {
      void fetchQueue(activeTab, searchQuery);
    }, 60000);

    // Socket events reload
    const socket = useAuthStore.getState().socket;
    const handleSocket = () => {
      void fetchQueue(activeTab, searchQuery);
    };

    if (socket) {
      REFETCH_EVENTS.forEach((e) => socket.on(e, handleSocket));
    }

    return () => {
      clearInterval(tickTimer);
      clearInterval(reloadTimer);
      if (socket) {
        REFETCH_EVENTS.forEach((e) => socket.off(e, handleSocket));
      }
    };
  }, [activeTab, searchQuery, fetchQueue]);

  // Search input handler with debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      void fetchQueue(activeTab, val);
    }, 300);
  };

  const handleDone = (nextOrderId: number | null) => {
    void fetchQueue(activeTab, searchQuery);
    if (nextOrderId) {
      setSelectedOrderId(nextOrderId);
    }
  };

  const handleRowClick = (order: QueueItem) => {
    if (window.innerWidth <= 760) {
      navigate(`/rep/call/${order.id}`);
    } else {
      setSelectedOrderId(order.id);
    }
  };

  const orders = queueData?.orders ?? [];
  const tabs = queueData?.tabs ?? { new: 0, call_back: 0, said_no: 0, not_reachable: 0, total: 0 };
  const targetMin = queueData?.firstCallTargetMinutes ?? 15;
  const alertMin = queueData?.queueWaitAlertMinutes ?? 30;

  // Header summary calculation
  const totalWaiting = tabs.total;
  const oldestOrder = orders.reduce<QueueItem | null>((oldest, curr) => {
    if (!oldest || curr.waitMinutes > oldest.waitMinutes) return curr;
    return oldest;
  }, null);

  const oldestText = oldestOrder
    ? `, oldest ${formatWaitDuration(oldestOrder.waitMinutes + (now - fetchTime) / 60000)}`
    : '';

  const tabList: Array<{ key: QueueTab; label: string; count: number }> = [
    { key: 'new', label: 'New', count: tabs.new },
    { key: 'call_back', label: 'Call back', count: tabs.call_back },
    { key: 'said_no', label: 'Said NO', count: tabs.said_no },
    { key: 'not_reachable', label: 'Not reachable', count: tabs.not_reachable },
  ];

  const fullName = user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : 'Call Rep';

  return (
    <div className="rep-queue-view" data-testid="rep-queue-page">
      {/* Header */}
      <div className="head">
        <div>
          <h1>Queue</h1>
          <p data-testid="queue-summary">
            Orders waiting for your call. {totalWaiting} waiting{oldestText}
          </p>
        </div>
        <button
          type="button"
          className="btn pri"
          data-testid="new-order-btn"
          onClick={() => setSheetOpen(true)}
        >
          <Plus size={16} />
          <span>New order</span>
        </button>
      </div>

      {/* Main Work Area */}
      <div className="work">
        <div className="card" id="qcard" data-testid="queue-card">
          {/* Tabs */}
          <div className="qtabs" data-testid="queue-tabs" role="tablist">
            {tabList.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                data-testid={`tab-${t.key}`}
                className={clsx('tab', activeTab === t.key && 'on')}
                onClick={() => setActiveTab(t.key)}
              >
                <span>{t.label}</span>
                <span className="pill" data-testid={`tab-count-${t.key}`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search bar */}
          <label className="find">
            <Search size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Name, phone, area or order #"
              aria-label="Search my queue"
              data-testid="queue-search-input"
            />
          </label>

          {/* Queue Order List */}
          <div className="qlist" data-testid="queue-list">
            {orders.length === 0 ? (
              <div className="empty" data-testid="queue-empty">
                <p>
                  {totalWaiting === 0
                    ? 'Queue is clear. New orders appear here as they come in.'
                    : 'Nothing here. Try another tab.'}
                </p>
              </div>
            ) : (
              orders.map((order) => {
                // Live ticking wait time
                const elapsedMin = Math.max(0, (now - fetchTime) / 60000);
                const currentWait = order.waitMinutes + elapsedMin;

                // Color severity bands: normal < targetMin <= gold < alertMin <= coral
                let severityClass = '';
                if (currentWait >= alertMin) {
                  severityClass = 'coral';
                } else if (currentWait >= targetMin) {
                  severityClass = 'gold';
                }

                // Call back handling
                const isCallbackTab = activeTab === 'call_back';
                const cbInfo = formatCallbackTime(order.callbackAt, now);
                const isLateCallback = isCallbackTab && (order.callbackDue || cbInfo.overdue);

                // Phone links
                const normalized = normalizePhone(order.customer.phoneNumber);
                const telUrl = normalized ? `tel:${normalized}` : undefined;
                const cleanDigits = normalized ? normalized.replace(/\D/g, '') : '';
                const waUrl = cleanDigits ? `https://wa.me/${cleanDigits}` : undefined;

                return (
                  <div
                    key={order.id}
                    data-testid={`queue-item-${order.id}`}
                    className={clsx(
                      'qi',
                      selectedOrderId === order.id && 'sel',
                      isLateCallback && 'late-callback'
                    )}
                    onClick={() => handleRowClick(order)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        handleRowClick(order);
                      }
                    }}
                  >
                    {/* Wait Timer or Call back box */}
                    {isCallbackTab && order.callbackAt ? (
                      <div
                        className={clsx('wt', isLateCallback ? 'coral' : 'normal')}
                        data-testid={`callback-timer-${order.id}`}
                      >
                        <small>Call back</small>
                        <b>{cbInfo.text}</b>
                      </div>
                    ) : (
                      <div
                        className={clsx('wt', severityClass)}
                        data-testid={`wait-timer-${order.id}`}
                      >
                        <small>Waiting</small>
                        <b>{formatWaitDuration(currentWait)}</b>
                      </div>
                    )}

                    {/* Order Details */}
                    <div className="qm">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <b>{order.customer.name}</b>
                        {order.saidNo && (
                          <span className="tag bad" data-testid="said-no-flag">
                            Said NO - call once before cancel
                          </span>
                        )}
                      </div>
                      <small>
                        {order.area ? `${order.area} · ` : ''}
                        {order.itemsSummary} · GH₵{order.totalAmount}
                      </small>
                    </div>

                    {/* Actions */}
                    <div className="qa" onClick={(e) => e.stopPropagation()}>
                      {telUrl ? (
                        <a
                          href={telUrl}
                          className="ibtn call"
                          title="Call customer"
                          aria-label={`Call ${order.customer.name}`}
                          data-testid={`call-btn-${order.id}`}
                        >
                          <Phone size={15} />
                        </a>
                      ) : null}

                      {waUrl ? (
                        <a
                          href={waUrl}
                          className="ibtn"
                          title="WhatsApp customer"
                          aria-label={`WhatsApp ${order.customer.name}`}
                          data-testid={`wa-btn-${order.id}`}
                        >
                          <MessageCircle size={15} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right desktop panel */}
        {selectedOrderId && (
          <QueueCallPanel orderId={selectedOrderId} onDone={handleDone} />
        )}
      </div>

      {/* New Order Drawer */}
      {sheetOpen && user && (
        <NewOrderSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onCreated={() => {
            setSheetOpen(false);
            void fetchQueue(activeTab, searchQuery);
          }}
          canAssign={false}
          reps={[{ value: user.id, label: fullName }]}
          agents={[]}
        />
      )}
    </div>
  );
};

export default RepQueuePage;
