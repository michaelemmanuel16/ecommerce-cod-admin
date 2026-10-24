import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertCircle, Boxes, Package, Truck } from 'lucide-react';
import { inventoryService, type StockLevelRow, type Transfer } from '../services/inventory.service';
import { ReceiveDialog } from './inventory/TransferDialogs';
import { MOVE_LABEL, num, placeName, shortDateTime, signedQuantity, statusView } from './inventory/model';

const HISTORY_LIMIT = 20;

/**
 * The delivery agent's own stock (M4-T25, F-653). It reads /api/inventory/levels and /transfers, which the server limits to
 * the agent's own stock location, and shows no cost. Stock sent to the agent waits here until the agent confirms what arrived
 * (POST /transfers/:id/receive, own stock only). Agents do not count stock in the app: the owner enters an agent's count.
 * Stays an old-style page until the agent app (M10) replaces it.
 */
export default function AgentMyInventory() {
  const [levels, setLevels] = useState<StockLevelRow[] | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [failed, setFailed] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);

  const load = useCallback(async () => {
    try {
      const [rows, list] = await Promise.all([inventoryService.levels(true), inventoryService.transfers({ limit: HISTORY_LIMIT }, true)]);
      setLevels(rows);
      setTransfers(list.transfers);
      setFailed(false);
    } catch {
      setFailed(true);
      setLevels((l) => l ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (levels === null) {
    return (
      <div className="flex items-center justify-center h-64">
        <div role="status" className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600">
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  // Every row of the answer is at the agent's own location, so its id says which transfers are addressed to this agent.
  const mine = levels[0]?.locationId ?? null;
  const waiting = transfers.filter((t) => t.status === 'in_transit' && mine !== null && t.toLocation?.id === mine);
  const onHand = levels.reduce((sum, l) => sum + l.onHand, 0);
  const coming = levels.reduce((sum, l) => sum + l.inTransit, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">My Inventory</h1>
        <p className="text-gray-600 mt-1">The stock you hold, and the stock on its way to you</p>
      </div>

      {failed && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Your stock could not load. <button className="underline font-medium" onClick={() => void load()}>Try again</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Products', value: levels.length, Icon: Package, card: 'from-blue-50 to-blue-100 border-blue-200', text: 'text-blue-700', big: 'text-blue-900', chip: 'bg-blue-500' },
          { label: 'On hand', value: onHand, Icon: Boxes, card: 'from-green-50 to-green-100 border-green-200', text: 'text-green-700', big: 'text-green-900', chip: 'bg-green-500' },
          { label: 'On the way to you', value: coming, Icon: Truck, card: 'from-purple-50 to-purple-100 border-purple-200', text: 'text-purple-700', big: 'text-purple-900', chip: 'bg-purple-500' },
        ].map(({ label, value, Icon, card, text, big, chip }) => (
          <div key={label} className={`bg-gradient-to-br ${card} rounded-lg shadow-sm p-6 border`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm ${text} font-medium`}>{label}</p>
                <p className={`text-2xl font-bold ${big} mt-1`}>{num(value)}</p>
              </div>
              <div className={`${chip} p-3 rounded-lg`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {waiting.length > 0 && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-purple-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-purple-200 bg-purple-50">
            <h2 className="text-lg font-semibold text-gray-900">Waiting for you</h2>
            <p className="text-sm text-gray-600">Count what arrived, then confirm it. Until you do, it is not in your stock.</p>
          </div>
          <ul className="divide-y divide-gray-100">
            {waiting.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t.product.name} &times; {num(t.quantity)}</p>
                  <p className="text-xs text-gray-500">From {placeName(t, 'from')}, {shortDateTime(t.createdAt)}{t.overdue ? ' · Overdue' : ''}</p>
                </div>
                <button
                  className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  aria-label={`Confirm received: ${t.product.name}`}
                  onClick={() => setReceiving(t)}
                >
                  Confirm received
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Assigned Stock</h2>
        </div>
        {levels.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <div className="bg-gray-100 p-4 rounded-full mb-4">
              <AlertCircle className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No inventory assigned yet</h3>
            <p className="text-gray-600 text-center max-w-md">Your assigned stock will appear here once an administrator allocates products to you.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200" aria-label="My stock">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">On Hand</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Reserved</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">In Transit</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {levels.map((l) => (
                  <tr key={l.productId}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{l.productName}</div>
                      <div className="text-sm text-gray-500">{l.sku}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">{num(l.onHand)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{num(l.reserved)}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">{num(l.inTransit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h2 className="text-lg font-semibold text-gray-900">Recent moves</h2>
        </div>
        {transfers.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-500 text-center">No moves yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {transfers.map((t) => {
              const s = statusView(t);
              return (
                <li key={t.id} className="flex items-start justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{MOVE_LABEL[t.transferType]}: {t.product.name}</p>
                    <p className="text-xs text-gray-500">{placeName(t, 'from')} &rarr; {placeName(t, 'to')} · {shortDateTime(t.createdAt)}</p>
                    {s.sub && <p className="text-xs text-gray-400">{s.sub}</p>}
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="text-sm font-semibold text-gray-900">{signedQuantity(t)}</p>
                    <p className="text-xs text-gray-500">{s.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ReceiveDialog
        transfer={receiving}
        onClose={() => setReceiving(null)}
        onDone={(message) => {
          setReceiving(null);
          toast.success(message);
          void load();
        }}
      />
    </div>
  );
}
