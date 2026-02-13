import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { deliveryAgentsService, DeliveryAgent } from '../../services/delivery-agents.service';

interface AllocateStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (agentId: number, quantity: number, notes?: string) => Promise<void>;
  productName: string;
  warehouseStock: number;
}

export const AllocateStockModal: React.FC<AllocateStockModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  productName,
  warehouseStock,
}) => {
  const [agents, setAgents] = useState<DeliveryAgent[]>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoadingAgents(true);
      deliveryAgentsService
        .getDeliveryAgents()
        .then((data) => setAgents(data.filter((a) => a.isActive)))
        .finally(() => setLoadingAgents(false));
      // Reset form
      setAgentId('');
      setQuantity('');
      setNotes('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId || !quantity) return;

    setIsSubmitting(true);
    try {
      await onSubmit(parseInt(agentId), parseInt(quantity), notes || undefined);
      onClose();
    } catch {
      // Error handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  const qty = parseInt(quantity) || 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Allocate Stock to Agent">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="text-sm text-gray-600 mb-3">
            Product: <span className="font-medium text-gray-900">{productName}</span>
          </p>
          <p className="text-sm text-gray-600">
            Warehouse Stock: <span className="font-medium text-gray-900">{warehouseStock}</span>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Delivery Agent
          </label>
          {loadingAgents ? (
            <p className="text-sm text-gray-500">Loading agents...</p>
          ) : (
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select an agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Quantity
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            min={1}
            max={warehouseStock}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {qty > warehouseStock && (
            <p className="mt-1 text-sm text-red-600">
              Exceeds warehouse stock ({warehouseStock})
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={500}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting || !agentId || qty < 1 || qty > warehouseStock}
          >
            {isSubmitting ? 'Allocating...' : 'Allocate Stock'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
