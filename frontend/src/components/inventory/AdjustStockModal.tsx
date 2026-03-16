import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface AdjustStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (newQuantity: number, notes: string) => Promise<void>;
  productName: string;
  agentName: string;
  currentQuantity: number;
}

export const AdjustStockModal: React.FC<AdjustStockModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  productName,
  agentName,
  currentQuantity,
}) => {
  const [newQuantity, setNewQuantity] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newQuantity === '' || !notes.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit(parseInt(newQuantity), notes.trim());
      onClose();
    } catch {
      // Error handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  const qty = parseInt(newQuantity);
  const isValid = !isNaN(qty) && qty >= 0 && qty !== currentQuantity && notes.trim().length > 0;

  React.useEffect(() => {
    if (isOpen) {
      setNewQuantity('');
      setNotes('');
    }
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Adjust Agent Stock">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-gray-600">
            Product: <span className="font-medium text-gray-900">{productName}</span>
          </p>
          <p className="text-sm text-gray-600">
            Agent: <span className="font-medium text-gray-900">{agentName}</span>
          </p>
          <p className="text-sm text-gray-600">
            Current On Hand: <span className="font-medium text-gray-900">{currentQuantity}</span>
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            New Quantity
          </label>
          <input
            type="number"
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
            min={0}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          {!isNaN(qty) && qty !== currentQuantity && (
            <p className={`mt-1 text-sm ${qty > currentQuantity ? 'text-green-600' : 'text-red-600'}`}>
              {qty > currentQuantity ? '+' : ''}{qty - currentQuantity} units
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reason for Adjustment (required)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="e.g., Physical count correction, damaged goods..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            maxLength={500}
            required
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting || !isValid}
          >
            {isSubmitting ? 'Adjusting...' : 'Adjust Stock'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
