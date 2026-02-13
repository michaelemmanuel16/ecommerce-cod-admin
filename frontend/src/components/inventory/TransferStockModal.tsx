import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { deliveryAgentsService, DeliveryAgent } from '../../services/delivery-agents.service';

interface TransferStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (toAgentId: number, quantity: number, notes?: string) => Promise<void>;
  productName: string;
  fromAgentId: number;
  fromAgentName: string;
  availableQuantity: number;
}

export const TransferStockModal: React.FC<TransferStockModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  productName,
  fromAgentId,
  fromAgentName,
  availableQuantity,
}) => {
  const [agents, setAgents] = useState<DeliveryAgent[]>([]);
  const [toAgentId, setToAgentId] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      deliveryAgentsService
        .getDeliveryAgents()
        .then((data) => setAgents(data.filter((a) => a.isActive && Number(a.id) !== fromAgentId)));
      setToAgentId('');
      setQuantity('');
      setNotes('');
    }
  }, [isOpen, fromAgentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toAgentId || !quantity) return;

    setIsSubmitting(true);
    try {
      await onSubmit(parseInt(toAgentId), parseInt(quantity), notes || undefined);
      onClose();
    } catch {
      // Error handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  const qty = parseInt(quantity) || 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Transfer Stock Between Agents">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-gray-600">
            Product: <span className="font-medium text-gray-900">{productName}</span>
          </p>
          <p className="text-sm text-gray-600">
            From: <span className="font-medium text-gray-900">{fromAgentName}</span>
          </p>
          <p className="text-sm text-gray-600">
            Available: <span className="font-medium text-gray-900">{availableQuantity}</span>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Transfer To
          </label>
          <select
            value={toAgentId}
            onChange={(e) => setToAgentId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value="">Select destination agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
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
            max={availableQuantity}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {qty > availableQuantity && (
            <p className="mt-1 text-sm text-red-600">
              Exceeds available stock ({availableQuantity})
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
            disabled={isSubmitting || !toAgentId || qty < 1 || qty > availableQuantity}
          >
            {isSubmitting ? 'Transferring...' : 'Transfer Stock'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
