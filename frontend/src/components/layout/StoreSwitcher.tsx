import React, { useEffect, useState } from 'react';
import { Store as StoreIcon, ChevronDown, Check, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Dropdown, DropdownItem } from '../ui/Dropdown';
import { useAuthStore } from '../../stores/authStore';
import { storesService, Store } from '../../services/stores.service';

const PLANS = [
  { name: 'growth', displayName: 'Growth' },
  { name: 'scale', displayName: 'Scale' },
];

function sortStores(stores: Store[]): Store[] {
  return [...stores].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function AddStoreModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [planName, setPlanName] = useState('growth');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { authorizationUrl } = await storesService.createStore(name.trim(), planName);
      window.location.href = authorizationUrl;
    } catch {
      setError('Could not start checkout. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-6 max-w-sm w-full">
        <h3 className="text-lg font-semibold text-gray-900">Add a store</h3>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Store name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Plan</label>
            <div className="grid grid-cols-2 gap-3">
              {PLANS.map((plan) => (
                <button
                  key={plan.name}
                  type="button"
                  onClick={() => setPlanName(plan.name)}
                  className={`rounded-lg border-2 px-4 py-3 text-sm font-semibold ${
                    planName === plan.name ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700'
                  }`}
                >
                  {plan.displayName}
                </button>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="min-h-[44px] px-5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
            >
              {busy ? 'Redirecting to Paystack…' : 'Continue to payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export const StoreSwitcher: React.FC = () => {
  const { stores, fetchStores, switchStore } = useAuthStore();
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  if (stores.length === 0) return null;

  const activeStore = stores.find((s) => s.isActive);

  const handleSelect = async (store: Store) => {
    if (store.subscriptionStatus === 'pending' || store.isActive) return;
    try {
      await switchStore(store.tenantId);
    } catch {
      toast.error('Could not switch stores. Please try again.');
    }
  };

  // Single-store owners have nothing to switch between, so skip the list
  // entirely and go straight to the one thing they'd use this for.
  if (stores.length === 1) {
    return (
      <>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <StoreIcon className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-900 max-w-[10rem] truncate">{activeStore?.name}</span>
          <Plus className="w-4 h-4 text-gray-400" />
        </button>
        {showAddModal && <AddStoreModal onClose={() => setShowAddModal(false)} />}
      </>
    );
  }

  const sorted = sortStores(stores);

  return (
    <>
      <Dropdown
        panelClassName="w-72"
        trigger={
          <button className="flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors">
            <StoreIcon className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-900 max-w-[10rem] truncate">{activeStore?.name ?? 'Select store'}</span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
        }
      >
        <div className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Your stores</div>
        {sorted.map((store) => {
          const isPending = store.subscriptionStatus === 'pending';
          return (
            <DropdownItem
              key={store.tenantId}
              onClick={() => handleSelect(store)}
              className={`flex items-center justify-between gap-2 ${
                store.isActive ? 'bg-blue-50 text-blue-700' : ''
              } ${isPending ? 'cursor-not-allowed text-gray-400' : ''}`}
            >
              <span className="truncate">{store.name}</span>
              {store.isActive && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
              {isPending && (
                <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">Pending pay</span>
              )}
            </DropdownItem>
          );
        })}
        <div className="border-t border-gray-100 mt-1 pt-1">
          <DropdownItem onClick={() => setShowAddModal(true)} className="flex items-center gap-2 text-blue-600 font-medium">
            <Plus className="w-4 h-4" />
            Add a store
          </DropdownItem>
        </div>
      </Dropdown>
      {showAddModal && <AddStoreModal onClose={() => setShowAddModal(false)} />}
    </>
  );
};
