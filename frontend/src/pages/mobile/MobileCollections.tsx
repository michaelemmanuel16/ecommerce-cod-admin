import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Wallet, RefreshCw, Send, Clock, CheckCircle, XCircle, Camera, AlertTriangle, FileText } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { financialService, CollectionRecord } from '../../services/financial.service';
import { deliveriesService } from '../../services/deliveries.service';
import { resizeImage } from '../../utils/imageResize';
import { formatCurrency } from '../../utils/format';
import { Skeleton } from '../../components/ui/Skeleton';
import toast from 'react-hot-toast';

type Tab = 'collections' | 'deposits' | 'new';

const DEPOSIT_METHODS = [
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
] as const;

const DEPOSIT_METHOD_LABELS: Record<string, string> = Object.fromEntries(
  DEPOSIT_METHODS.map(m => [m.value, m.label])
);

const COLLECTION_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  draft: { color: 'bg-gray-100 text-gray-700', label: 'Draft' },
  verified: { color: 'bg-blue-100 text-blue-700', label: 'Verified' },
  approved: { color: 'bg-green-100 text-green-700', label: 'Approved' },
  deposited: { color: 'bg-purple-100 text-purple-700', label: 'Deposited' },
  reconciled: { color: 'bg-teal-100 text-teal-700', label: 'Reconciled' },
};

const DEPOSIT_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: 'bg-yellow-100 text-yellow-700', label: 'Pending' },
  verified: { color: 'bg-green-100 text-green-700', label: 'Verified' },
  rejected: { color: 'bg-red-100 text-red-700', label: 'Rejected' },
};

interface AgentBalance {
  id: number;
  agentId: number;
  totalCollected: number;
  totalDeposited: number;
  currentBalance: number;
  lastSettlementDate?: string;
  isBlocked: boolean;
}

interface DepositRecord {
  id: number;
  agentId: number;
  amount: number;
  status: 'pending' | 'verified' | 'rejected';
  depositDate: string;
  depositMethod: string;
  referenceNumber: string;
  notes?: string;
  receiptUrl?: string;
}

export default function MobileCollections() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>('collections');

  // Balance state
  const [balance, setBalance] = useState<AgentBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Collections state
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);

  // Deposits state — lazy-loaded on first tab visit
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const depositsLoaded = useRef(false);

  // Pull-to-refresh — use ref to avoid per-frame re-renders
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const pullDistanceRef = useRef(0);
  const [pullVisible, setPullVisible] = useState(false);
  const [pullReady, setPullReady] = useState(false);
  const pullIndicatorRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  // New deposit form state
  const [amount, setAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState('');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  // Derive balance from actual collections (source of truth), not the AgentBalance table
  // which can drift out of sync. This matches what the admin aging report shows.
  const collectionsSummary = useMemo(() => {
    let totalCollected = 0;
    let outstanding = 0;
    for (const c of collections) {
      const amt = Number(c.amount);
      totalCollected += amt;
      // Outstanding = not yet reconciled (draft, verified, approved are still owed)
      if (c.status !== 'deposited' && c.status !== 'reconciled') {
        outstanding += amt;
      }
    }
    const deposited = totalCollected - outstanding;
    return { totalCollected, deposited, outstanding };
  }, [collections]);

  const outstandingBalance = collectionsSummary.outstanding;

  // Only show non-reconciled collections — agents don't need to see settled items
  const pendingCollections = useMemo(
    () => collections.filter(c => c.status !== 'reconciled'),
    [collections]
  );

  const todayStr = useMemo(
    () => new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
    []
  );

  const fetchBalance = useCallback(async () => {
    if (!user) return;
    try {
      const data = await financialService.getAgentBalance(user.id);
      setBalance(data);
    } catch {
      setBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [user]);

  const fetchCollections = useCallback(async () => {
    if (!user) return;
    setCollectionsLoading(true);
    try {
      const data = await financialService.getAgentCollections(user.id);
      setCollections(data);
    } catch {
      toast.error('Failed to load collections');
    } finally {
      setCollectionsLoading(false);
    }
  }, [user]);

  const fetchDeposits = useCallback(async () => {
    if (!user) return;
    setDepositsLoading(true);
    try {
      const data = await financialService.getAgentDeposits({ agentId: user.id });
      setDeposits(data);
      depositsLoaded.current = true;
    } catch {
      toast.error('Failed to load deposits');
    } finally {
      setDepositsLoading(false);
    }
  }, [user]);

  // Load balance + collections on mount, deposits lazily
  useEffect(() => {
    fetchBalance();
    fetchCollections();
  }, [fetchBalance, fetchCollections]);

  // Lazy-load deposits when tab is first activated
  useEffect(() => {
    if ((activeTab === 'deposits' || activeTab === 'new') && !depositsLoaded.current) {
      fetchDeposits();
    }
  }, [activeTab, fetchDeposits]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const fetches = [fetchBalance(), fetchCollections()];
    if (depositsLoaded.current) fetches.push(fetchDeposits());
    await Promise.all(fetches);
    setRefreshing(false);
  }, [fetchBalance, fetchCollections, fetchDeposits]);

  // Pull-to-refresh handlers — use refs to avoid per-frame state updates
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      const diff = e.touches[0].clientY - touchStartY.current;
      if (diff > 0) {
        pullDistanceRef.current = Math.min(diff, 100);
        // Update DOM directly to avoid React re-renders
        if (pullIndicatorRef.current) {
          pullIndicatorRef.current.style.height = `${pullDistanceRef.current}px`;
          pullIndicatorRef.current.style.display = pullDistanceRef.current > 0 ? 'flex' : 'none';
        }
        const ready = pullDistanceRef.current > 60;
        if (ready !== pullReady) setPullReady(ready);
        if (!pullVisible) setPullVisible(true);
      }
    }
  }, [pullReady, pullVisible]);

  const handleTouchEnd = useCallback(() => {
    if (pullDistanceRef.current > 60) handleRefresh();
    pullDistanceRef.current = 0;
    if (pullIndicatorRef.current) {
      pullIndicatorRef.current.style.height = '0px';
      pullIndicatorRef.current.style.display = 'none';
    }
    setPullVisible(false);
    setPullReady(false);
  }, [handleRefresh]);

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeImage(file);
      setPhoto(resized);
    } catch {
      toast.error('Failed to process photo');
    }
  };

  const handleSubmitDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!depositMethod) {
      toast.error('Select a deposit method');
      return;
    }
    if (parseFloat(amount) > outstandingBalance) {
      toast.error('Amount exceeds your outstanding balance');
      return;
    }

    setSubmitting(true);
    try {
      let receiptUrl: string | undefined;
      if (photo) {
        const uploadResult = await deliveriesService.uploadImage(photo);
        receiptUrl = uploadResult.imageUrl;
      }

      // Auto-generate reference number (backend requires unique value)
      const now = new Date();
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const ref = `DEP-${date}-${rand}`;

      await financialService.createDeposit({
        amount: parseFloat(amount),
        depositMethod,
        referenceNumber: ref,
        notes: notes.trim() || undefined,
        receiptUrl,
      });

      toast.success('Deposit submitted successfully');
      // Reset form
      setAmount('');
      setDepositMethod('');
      setNotes('');
      setPhoto(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Refresh data
      setActiveTab('deposits');
      await Promise.all([fetchBalance(), fetchDeposits()]);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to submit deposit');
    } finally {
      setSubmitting(false);
    }
  };

  const tabs = useMemo<{ key: Tab; label: string; count?: number }[]>(() => [
    { key: 'collections', label: 'Collections', count: pendingCollections.length },
    { key: 'deposits', label: 'Deposits', count: depositsLoaded.current ? deposits.length : undefined },
    { key: 'new', label: 'New Deposit' },
  ], [pendingCollections.length, deposits.length]);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 pt-3 pb-2 border-b">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-semibold text-gray-900">Collections</h1>
          <span className="text-xs text-gray-500">{todayStr}</span>
        </div>

        {/* Outstanding Balance */}
        {collectionsLoading ? (
          <Skeleton className="h-12 rounded-lg mb-3" />
        ) : (
          <div className={`rounded-lg px-4 py-3 mb-3 flex items-center justify-between ${outstandingBalance > 0 ? 'bg-orange-50' : 'bg-green-50'}`}>
            <span className={`text-xs font-medium ${outstandingBalance > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {outstandingBalance > 0 ? 'You owe' : 'All settled'}
            </span>
            <span className={`text-lg font-bold ${outstandingBalance > 0 ? 'text-orange-900' : 'text-green-900'}`}>
              {formatCurrency(outstandingBalance)}
            </span>
          </div>
        )}

        {/* Tab Bar */}
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
              {tab.count != null ? ` (${tab.count})` : ''}
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
        {/* Pull-to-refresh indicator — DOM-driven to avoid per-frame re-renders */}
        <div
          ref={pullIndicatorRef}
          className="items-center justify-center text-gray-400 transition-all overflow-hidden"
          style={{ height: 0, display: 'none' }}
        >
          <RefreshCw size={20} className={pullReady ? 'text-blue-500 animate-spin' : ''} />
        </div>
        {refreshing && (
          <div className="flex items-center justify-center py-3">
            <RefreshCw size={18} className="text-blue-500 animate-spin" />
            <span className="ml-2 text-xs text-gray-500">Refreshing...</span>
          </div>
        )}

        <div className="p-4 space-y-3">
          {/* Collections Tab */}
          {activeTab === 'collections' && (
            collectionsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl p-4 shadow-sm space-y-2">
                  <div className="flex justify-between"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-16" /></div>
                  <Skeleton className="h-4 w-40" />
                  <div className="flex justify-between"><Skeleton className="h-5 w-20" /><Skeleton className="h-4 w-12" /></div>
                </div>
              ))
            ) : pendingCollections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Wallet size={48} strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium">No collections yet</p>
                <p className="text-xs text-gray-400 mt-1">Collections appear when you deliver orders</p>
              </div>
            ) : (
              pendingCollections.map((c) => {
                const statusConfig = COLLECTION_STATUS_CONFIG[c.status] || { color: 'bg-gray-100 text-gray-700', label: c.status };
                return (
                  <div key={c.id} className="bg-white rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-sm font-semibold text-gray-900">
                        Order #{c.order?.id || c.orderId}
                      </span>
                      <span className="text-sm font-bold text-gray-900">
                        {formatCurrency(Number(c.amount))}
                      </span>
                    </div>
                    {c.order?.customer && (
                      <p className="text-xs text-gray-500 mb-2">
                        {c.order.customer.firstName} {c.order.customer.lastName}
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusConfig.color}`}>
                        {statusConfig.label}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        {new Date(c.collectionDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })
            )
          )}

          {/* Deposits Tab */}
          {activeTab === 'deposits' && (
            depositsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl p-4 shadow-sm space-y-2">
                  <div className="flex justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-16" /></div>
                  <Skeleton className="h-4 w-36" />
                  <div className="flex justify-between"><Skeleton className="h-5 w-20" /><Skeleton className="h-4 w-12" /></div>
                </div>
              ))
            ) : deposits.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Send size={48} strokeWidth={1.5} />
                <p className="mt-3 text-sm font-medium">No deposits yet</p>
                <p className="text-xs text-gray-400 mt-1">Submit a deposit to track your payments</p>
              </div>
            ) : (
              deposits.map((d) => {
                const statusConfig = DEPOSIT_STATUS_CONFIG[d.status] || { color: 'bg-gray-100 text-gray-700', label: d.status };
                const StatusIcon = d.status === 'verified' ? CheckCircle : d.status === 'rejected' ? XCircle : Clock;
                return (
                  <div key={d.id} className="bg-white rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-start mb-1.5">
                      <div className="flex items-center gap-2">
                        <StatusIcon size={14} className={
                          d.status === 'verified' ? 'text-green-500' :
                          d.status === 'rejected' ? 'text-red-500' :
                          'text-yellow-500'
                        } />
                        <span className="text-sm font-semibold text-gray-900">
                          Ref: {d.referenceNumber}
                        </span>
                      </div>
                      <span className="text-sm font-bold text-gray-900">
                        {formatCurrency(Number(d.amount))}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      {DEPOSIT_METHOD_LABELS[d.depositMethod] || d.depositMethod}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusConfig.color}`}>
                        {statusConfig.label}
                      </span>
                      <div className="flex items-center gap-2">
                        {d.receiptUrl && (
                          <a href={d.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500">
                            <FileText size={14} />
                          </a>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {new Date(d.depositDate).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )
          )}

          {/* New Deposit Tab */}
          {activeTab === 'new' && (
            <div className="space-y-4">
              {outstandingBalance <= 0 && (
                <div className="bg-green-50 rounded-xl p-4 flex items-center gap-3">
                  <CheckCircle size={20} className="text-green-600 flex-shrink-0" />
                  <p className="text-sm text-green-800">No outstanding balance. You're all settled!</p>
                </div>
              )}

              {outstandingBalance > 0 && (
                <div className="bg-orange-50 rounded-xl p-4 flex items-center gap-3">
                  <AlertTriangle size={20} className="text-orange-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-orange-800">Outstanding: {formatCurrency(outstandingBalance)}</p>
                    <p className="text-xs text-orange-600">Submit a deposit to clear your balance</p>
                  </div>
                </div>
              )}

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">GH₵</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max={outstandingBalance || undefined}
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={outstandingBalance <= 0}
                  />
                </div>
              </div>

              {/* Deposit Method */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deposit Method</label>
                <select
                  value={depositMethod}
                  onChange={e => setDepositMethod(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
                  disabled={outstandingBalance <= 0}
                >
                  <option value="">Select method...</option>
                  {DEPOSIT_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any additional details..."
                  rows={2}
                  className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  disabled={outstandingBalance <= 0}
                />
              </div>

              {/* Receipt Photo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Photo (optional)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoCapture}
                  className="hidden"
                  disabled={outstandingBalance <= 0}
                />
                {photoPreview ? (
                  <div className="relative">
                    <img src={photoPreview} alt="Receipt" className="w-full h-40 object-cover rounded-xl" />
                    <button
                      onClick={() => { setPhoto(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1.5"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={outstandingBalance <= 0}
                    className="w-full py-8 border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-gray-400 active:bg-gray-50 disabled:opacity-50"
                  >
                    <Camera size={24} />
                    <span className="text-xs mt-1">Tap to capture receipt</span>
                  </button>
                )}
              </div>

              {/* Submit Button */}
              <button
                onClick={handleSubmitDeposit}
                disabled={submitting || outstandingBalance <= 0}
                className="w-full py-3.5 bg-blue-600 text-white font-semibold rounded-xl text-sm active:bg-blue-700 disabled:opacity-50 disabled:active:bg-blue-600 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Submit Deposit
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
