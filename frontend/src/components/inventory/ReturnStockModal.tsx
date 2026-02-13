import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface ReturnStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (quantity: number, notes?: string) => Promise<void>;
  productName: string;
  agentName: string;
  availableQuantity: number;
}

export const ReturnStockModal: React.FC<ReturnStockModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  productName,
  agentName,
  availableQuantity,
}) => {
  const [quantity, setQuantity] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quantity) return;

    setIsSubmitting(true);
    try {
      await onSubmit(parseInt(quantity), notes || undefined);
      onClose();
    } catch {
      // Error handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  const qty = parseInt(quantity) || 0;

  // Reset form when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setQuantity('');
      setNotes('');
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Return Stock to Warehouse">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-gray-600">
            Product: <span className="font-medium text-gray-900">{productName}</span>
          </p>
          <p className="text-sm text-gray-600">
            Agent: <span className="font-medium text-gray-900">{agentName}</span>
          </p>
          <p className="text-sm text-gray-600">
            On Hand: <span className="font-medium text-gray-900">{availableQuantity}</span>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Quantity to Return
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
              Exceeds agent's on-hand stock ({availableQuantity})
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason for Return (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g., End of period return, unsold inventory..."
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
            disabled={isSubmitting || qty < 1 || qty > availableQuantity}
          >
            {isSubmitting ? 'Returning...' : 'Return to Warehouse'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
