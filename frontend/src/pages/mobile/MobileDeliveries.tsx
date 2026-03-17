import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, MapPin, RefreshCw, Package } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { deliveriesService, DeliveryListItem, formatDeliveryAddress } from '../../services/deliveries.service';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ORDER_STATUS_CONFIG } from '../../utils/constants';
import { OrderStatus } from '../../types';
import toast from 'react-hot-toast';

type Tab = 'all' | 'pending' | 'transit' | 'done';

const TAB_STATUSES: Record<Exclude<Tab, 'all'>, OrderStatus[]> = {
  pending: ['ready_for_pickup'],
  transit: ['out_for_delivery'],
  done: ['delivered', 'failed_delivery'],
};

export default function MobileDeliveries() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [deliveries, setDeliveries] = useState<DeliveryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('all');

  // Pull-to-refresh state
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);

  const fetchDeliveries = useCallback(async (showRefresh = false) => {
    if (!user) return;
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await deliveriesService.getDeliveries({ agentId: user.id, limit: 100 });
      setDeliveries(data.deliveries || []);
    } catch {
      toast.error('Failed to load deliveries');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  // Pull-to-refresh handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 0) {
        setPullDistance(Math.min(diff, 100));
      }
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      fetchDeliveries(true);
    }
    setPullDistance(0);
  };

  // Compute tab counts and filtered list in a single pass
  const { tabCounts, filtered } = useMemo(() => {
    const counts = { all: deliveries.length, pending: 0, transit: 0, done: 0 };
    for (const d of deliveries) {
      const status = d.order?.status || '';
      if (TAB_STATUSES.pending.includes(status as OrderStatus)) counts.pending++;
      else if (TAB_STATUSES.transit.includes(status as OrderStatus)) counts.transit++;
      else if (TAB_STATUSES.done.includes(status as OrderStatus)) counts.done++;
    }
    const list = activeTab === 'all'
      ? deliveries
      : deliveries.filter(d => TAB_STATUSES[activeTab].includes((d.order?.status || '') as OrderStatus));
    return { tabCounts: counts, filtered: list };
  }, [deliveries, activeTab]);

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: tabCounts.all },
    { key: 'pending', label: 'Pending', count: tabCounts.pending },
    { key: 'transit', label: 'Transit', count: tabCounts.transit },
    { key: 'done', label: 'Done', count: tabCounts.done },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 pt-3 pb-2 border-b">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-gray-900">My Deliveries</h1>
          <span className="text-xs text-gray-500">
            {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ overscrollBehaviorY: 'contain' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull-to-refresh indicator */}
        {pullDistance > 0 && (
          <div
            className="flex items-center justify-center text-gray-400 transition-all"
            style={{ height: pullDistance }}
          >
            <RefreshCw
              size={20}
              className={pullDistance > 60 ? 'text-blue-500 animate-spin' : ''}
            />
          </div>
        )}

        {/* Refreshing indicator */}
        {refreshing && (
          <div className="flex items-center justify-center py-3">
            <RefreshCw size={18} className="text-blue-500 animate-spin" />
            <span className="ml-2 text-xs text-gray-500">Refreshing...</span>
          </div>
        )}

        <div className="p-4 space-y-3">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl p-4 shadow-sm space-y-3">
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-48" />
                <div className="flex justify-between items-center">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package size={48} strokeWidth={1.5} />
              <p className="mt-3 text-sm font-medium">
                {activeTab === 'all' ? 'No deliveries assigned' :
                 activeTab === 'pending' ? 'No pending deliveries' :
                 activeTab === 'transit' ? 'No deliveries in transit' :
                 'No completed deliveries'}
              </p>
            </div>
          ) : (
            filtered.map(delivery => {
              const customer = delivery.order?.customer;
              const customerName = customer ? `${customer.firstName} ${customer.lastName}` : 'Unknown';
              const address = formatDeliveryAddress(delivery.order);
              const status = (delivery.order?.status || '') as OrderStatus;
              const statusConfig = ORDER_STATUS_CONFIG[status];

              return (
                <div
                  key={delivery.id}
                  onClick={() => navigate(`/m/deliveries/${delivery.id}`)}
                  className="bg-white rounded-xl p-4 shadow-sm active:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-gray-900 text-sm">
                      {customerName}
                    </span>
                    <span className="font-bold text-gray-900 text-sm">
                      GH₵{(delivery.order?.totalAmount || 0).toFixed(2)}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 mb-2 line-clamp-1">
                    {address}
                  </p>

                  <div className="flex items-center justify-between">
                    <Badge variant="status" status={status}>
                      {statusConfig?.label || status}
                    </Badge>

                    <div className="flex items-center gap-3">
                      {customer?.phoneNumber && (
                        <a
                          href={`tel:${customer.phoneNumber}`}
                          onClick={e => e.stopPropagation()}
                          className="p-1.5 rounded-full bg-green-50 text-green-600 active:bg-green-100"
                        >
                          <Phone size={14} />
                        </a>
                      )}
                      {delivery.order?.deliveryAddress && (
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="p-1.5 rounded-full bg-blue-50 text-blue-600 active:bg-blue-100"
                        >
                          <MapPin size={14} />
                        </a>
                      )}
                      <span className="text-xs text-gray-400">
                        {formatTime(delivery.scheduledTime || delivery.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
