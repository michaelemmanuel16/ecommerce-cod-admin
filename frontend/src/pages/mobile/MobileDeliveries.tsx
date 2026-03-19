import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { startOfMonth } from 'date-fns';
import { Phone, MapPin, RefreshCw, Package, Search, X, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { deliveriesService, DeliveryListItem, DeliveryPagination, formatDeliveryAddress } from '../../services/deliveries.service';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ORDER_STATUS_CONFIG } from '../../utils/constants';
import { OrderStatus } from '../../types';
import toast from 'react-hot-toast';

type Tab = 'all' | 'pending' | 'transit' | 'done';

const TAB_STATUS_MAP: Record<Tab, string | undefined> = {
  all: undefined,
  pending: 'ready_for_pickup',
  transit: 'out_for_delivery',
  // 'done' requires multiple statuses — handled separately
  done: undefined,
};

const DONE_STATUSES = ['delivered', 'failed_delivery'];
const PAGE_SIZE = 20;

export default function MobileDeliveries() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [deliveries, setDeliveries] = useState<DeliveryListItem[]>([]);
  const [pagination, setPagination] = useState<DeliveryPagination | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  // Pull-to-refresh state
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const [pullDistance, setPullDistance] = useState(0);

  const isAuthenticated = !!user;

  // MTD date range for filtering terminal statuses
  const mtdStartDate = useMemo(() => startOfMonth(new Date()).toISOString(), []);

  const fetchDeliveries = useCallback(async (opts: { page?: number; append?: boolean; refresh?: boolean } = {}) => {
    if (!isAuthenticated) return;
    const { page = 1, append = false, refresh = false } = opts;

    if (refresh) setRefreshing(true);
    else if (!append) setLoading(true);
    else setLoadingMore(true);

    try {
      // Build status filter based on active tab
      let status: string | undefined;
      if (activeTab === 'done') {
        status = DONE_STATUSES.join(',');
      } else {
        status = TAB_STATUS_MAP[activeTab];
      }

      const data = await deliveriesService.getAgentOrders({
        status,
        page,
        limit: PAGE_SIZE,
        search: search || undefined,
        startDate: mtdStartDate,
        endDate: new Date().toISOString(),
      });

      if (append) {
        setDeliveries(prev => [...prev, ...(data.deliveries || [])]);
      } else {
        setDeliveries(data.deliveries || []);
      }
      setPagination(data.pagination);
      if (data.statusCounts) setStatusCounts(data.statusCounts);
    } catch {
      toast.error('Failed to load deliveries');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [isAuthenticated, activeTab, search, mtdStartDate]);

  useEffect(() => {
    fetchDeliveries();
  }, [fetchDeliveries]);

  // Debounced search
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(value);
    }, 400);
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearch('');
  };

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
      fetchDeliveries({ refresh: true });
    }
    setPullDistance(0);
  };

  const handleLoadMore = () => {
    if (pagination && pagination.page < pagination.pages) {
      fetchDeliveries({ page: pagination.page + 1, append: true });
    }
  };

  const hasMore = pagination ? pagination.page < pagination.pages : false;

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const tabCounts: Record<Tab, number | undefined> = {
    all: statusCounts.all,
    pending: statusCounts.ready_for_pickup,
    transit: statusCounts.out_for_delivery,
    done: (statusCounts.delivered || 0) + (statusCounts.failed_delivery || 0),
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'transit', label: 'Transit' },
    { key: 'done', label: 'Done' },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 pt-3 pb-2 border-b">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold text-gray-900">My Deliveries</h1>
          <span className="text-xs text-gray-500">
            {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>

        {/* Search Bar */}
        <div className="relative mb-2">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchInput}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search name, phone, address, order #..."
            className="w-full pl-9 pr-8 py-2 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
          />
          {searchInput && (
            <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400">
              <X size={14} />
            </button>
          )}
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
              {tab.label}
              {tabCounts[tab.key] != null ? ` (${tabCounts[tab.key]})` : ''}
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
          ) : deliveries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <Package size={48} strokeWidth={1.5} />
              <p className="mt-3 text-sm font-medium">
                {search ? 'No deliveries match your search' :
                 activeTab === 'all' ? 'No deliveries assigned' :
                 activeTab === 'pending' ? 'No pending deliveries' :
                 activeTab === 'transit' ? 'No deliveries in transit' :
                 'No completed deliveries'}
              </p>
              {search && (
                <button onClick={clearSearch} className="mt-2 text-blue-600 text-sm font-medium">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <>
              {deliveries.map(delivery => {
                const customer = delivery.order?.customer;
                const customerName = customer ? `${customer.firstName} ${customer.lastName}` : 'Unknown';
                const address = formatDeliveryAddress(delivery.order);
                const status = (delivery.order?.status || '') as OrderStatus;
                const statusConfig = ORDER_STATUS_CONFIG[status];

                return (
                  <div
                    key={`${delivery.id}-${delivery.orderId}`}
                    onClick={() => navigate(delivery.id > 0 ? `/m/deliveries/${delivery.id}` : `/m/deliveries/order/${delivery.orderId}`)}
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
              })}

              {/* Load More */}
              {hasMore && (
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="w-full py-3 flex items-center justify-center gap-2 text-sm font-medium text-blue-600 bg-white rounded-xl shadow-sm active:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Loading...
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} />
                      Load more ({pagination!.total - deliveries.length} remaining)
                    </>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
