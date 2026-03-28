import React, { useEffect, useState } from 'react';
import { Truck, Plus, Check, Trash2, Pencil } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { shipmentsService } from '../../services/shipments.service';
import { formatCurrency } from '../../utils/format';
import { InventoryShipment, Product, CreateShipmentPayload } from '../../types';
import { AddShipmentModal } from './AddShipmentModal';
import toast from 'react-hot-toast';

interface IncomingInventoryViewProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onShipmentArrived: () => void;
}

export const IncomingInventoryView: React.FC<IncomingInventoryViewProps> = ({
  isOpen,
  onClose,
  products,
  onShipmentArrived,
}) => {
  const [shipments, setShipments] = useState<InventoryShipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'arrived'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingShipment, setEditingShipment] = useState<InventoryShipment | null>(null);
  const [markingArrivedId, setMarkingArrivedId] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadShipments();
    }
  }, [isOpen]);

  const loadShipments = async () => {
    setIsLoading(true);
    try {
      const data = await shipmentsService.listShipments();
      setShipments(data);
    } catch {
      toast.error('Failed to load shipments');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddShipment = async (data: CreateShipmentPayload) => {
    try {
      if (editingShipment) {
        await shipmentsService.updateShipment(editingShipment.id, data);
        toast.success('Shipment updated');
        setEditingShipment(null);
      } else {
        await shipmentsService.createShipment(data);
        toast.success('Shipment added');
      }
      loadShipments();
    } catch {
      toast.error(editingShipment ? 'Failed to update shipment' : 'Failed to add shipment');
      throw new Error('save failed');
    }
  };

  const handleMarkArrived = async (id: number) => {
    if (!confirm('Mark this shipment as arrived? Stock will be updated and a GL entry will be created.')) return;
    setMarkingArrivedId(id);
    try {
      await shipmentsService.markArrived(id);
      toast.success('Shipment marked as arrived — stock updated');
      loadShipments();
      onShipmentArrived();
    } catch {
      toast.error('Failed to mark shipment as arrived');
    } finally {
      setMarkingArrivedId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this pending shipment?')) return;
    try {
      await shipmentsService.deleteShipment(id);
      toast.success('Shipment deleted');
      loadShipments();
    } catch {
      toast.error('Failed to delete shipment');
    }
  };

  const filtered = statusFilter === 'all'
    ? shipments
    : shipments.filter((s) => s.status === statusFilter);

  const pendingCount = shipments.filter((s) => s.status === 'pending').length;
  const totalPendingCost = shipments
    .filter((s) => s.status === 'pending')
    .reduce((sum, s) => sum + Number(s.totalCost), 0);

  const filterTabs: { key: typeof statusFilter; label: string }[] = [
    { key: 'all', label: `All (${shipments.length})` },
    { key: 'pending', label: `Pending (${pendingCount})` },
    { key: 'arrived', label: `Arrived (${shipments.length - pendingCount})` },
  ];

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Incoming Inventory" size="xl">
        <div className="space-y-4">
          {/* Summary bar */}
          {pendingCount > 0 && (
            <div className="flex items-center gap-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <Truck className="w-4 h-4 text-amber-600" />
              <span className="text-amber-800">
                <strong>{pendingCount}</strong> pending shipment{pendingCount !== 1 ? 's' : ''} worth{' '}
                <strong>{formatCurrency(totalPendingCost)}</strong>
              </span>
            </div>
          )}

          {/* Header with filter + add button */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {filterTabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    statusFilter === tab.key
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setShowAddModal(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Shipment
            </Button>
          </div>

          {/* Shipments table */}
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Supplier</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Unit Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Shipping</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Customs</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Other</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500">
                        Loading shipments...
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500">
                        No shipments found
                      </td>
                    </tr>
                  ) : (
                    filtered.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <div className="font-medium text-gray-900">{s.product.name}</div>
                          <div className="text-xs text-gray-500">{s.product.sku}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {s.supplier || '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                          {s.quantity}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                          {formatCurrency(Number(s.unitCost))}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                          {Number(s.shippingCost) > 0 ? formatCurrency(Number(s.shippingCost)) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                          {Number(s.customsDuties) > 0 ? formatCurrency(Number(s.customsDuties)) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                          {Number(s.otherCosts) > 0 ? formatCurrency(Number(s.otherCosts)) : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                          {formatCurrency(Number(s.totalCost))}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700">
                          {s.expectedArrivalDate
                            ? new Date(s.expectedArrivalDate).toLocaleDateString()
                            : '—'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {s.status === 'pending' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              Pending
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Arrived
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          {s.status === 'pending' && (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { setEditingShipment(s); setShowAddModal(true); }}
                                className="p-1 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50"
                                title="Edit shipment"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleMarkArrived(s.id)}
                                disabled={markingArrivedId === s.id}
                                className="inline-flex items-center px-2 py-1 text-xs font-medium text-green-700 bg-green-50 rounded hover:bg-green-100 disabled:opacity-50"
                                title="Mark as arrived"
                              >
                                <Check className="w-3 h-3 mr-1" />
                                {markingArrivedId === s.id ? 'Updating...' : 'Arrived'}
                              </button>
                              <button
                                onClick={() => handleDelete(s.id)}
                                className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
                                title="Delete shipment"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </Modal>

      <AddShipmentModal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setEditingShipment(null); }}
        onSubmit={handleAddShipment}
        products={products}
        editingShipment={editingShipment}
      />
    </>
  );
};
