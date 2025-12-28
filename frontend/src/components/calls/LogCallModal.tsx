import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCallsStore } from '../../stores/callsStore';
import { CallOutcome } from '../../types';

interface LogCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: number;
  customerName: string;
  orderId?: number;
}

export const LogCallModal: React.FC<LogCallModalProps> = ({
  isOpen,
  onClose,
  customerId,
  customerName,
  orderId
}) => {
  const { createCall } = useCallsStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    outcome: CallOutcome.CONFIRMED,
    duration: '',
    notes: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsSubmitting(true);
      await createCall({
        customerId,
        orderId,
        outcome: formData.outcome,
        duration: formData.duration ? parseInt(formData.duration) : undefined,
        notes: formData.notes || undefined
      });

      // Reset form and close
      setFormData({
        outcome: CallOutcome.CONFIRMED,
        duration: '',
        notes: ''
      });
      onClose();
    } catch (error) {
      // Error handled by store
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log Call">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <p className="text-sm text-gray-600">
            Calling: <span className="font-medium text-gray-900">{customerName}</span>
          </p>
          {orderId && (
            <p className="text-sm text-gray-600 mt-1">
              Order: <span className="font-medium text-gray-900">#{orderId}</span>
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Call Outcome <span className="text-red-500">*</span>
          </label>
          <select
            value={formData.outcome}
            onChange={(e) => setFormData({ ...formData, outcome: e.target.value as CallOutcome })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          >
            <option value={CallOutcome.CONFIRMED}>Confirmed</option>
            <option value={CallOutcome.RESCHEDULED}>Rescheduled</option>
            <option value={CallOutcome.NO_ANSWER}>No Answer</option>
            <option value={CallOutcome.CANCELLED}>Cancelled</option>
            <option value={CallOutcome.OTHER}>Other</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Duration (seconds)
          </label>
          <input
            type="number"
            placeholder="Optional"
            value={formData.duration}
            onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
            min={0}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes (Optional)
          </label>
          <input
            type="text"
            placeholder="Brief note about the call"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            maxLength={500}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">{formData.notes.length}/500 characters</p>
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? 'Logging...' : 'Log Call'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
