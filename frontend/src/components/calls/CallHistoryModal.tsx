import React, { useState, useEffect, useCallback } from 'react';
import { Phone, Clock, FileText } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LogCallModal } from './LogCallModal';
import { callsService } from '../../services/calls.service';
import { Call } from '../../types';
import { outcomeColors, outcomeLabels } from './callOutcomeConfig';

interface CallHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: number;
  customerId: number;
  customerName: string;
}

export const CallHistoryModal: React.FC<CallHistoryModalProps> = ({
  isOpen,
  onClose,
  orderId,
  customerId,
  customerName,
}) => {
  const [calls, setCalls] = useState<Call[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLogCallOpen, setIsLogCallOpen] = useState(false);

  const fetchCalls = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await callsService.getCallsByOrder(orderId);
      setCalls(data);
    } catch {
      // Silently fail — toast handled at service layer
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    if (isOpen) {
      fetchCalls();
    }
  }, [isOpen, fetchCalls]);

  const formatDuration = (seconds?: number) => {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`Call History — Order #${orderId}`}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Customer: <span className="font-medium text-gray-900">{customerName}</span>
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsLogCallOpen(true)}
            >
              <Phone className="w-4 h-4 mr-1" />
              Log New Call
            </Button>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-gray-500 text-sm">Loading call history...</div>
          ) : calls.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No calls logged yet</div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {calls.map((call) => (
                <div key={call.id} className="border border-gray-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${outcomeColors[call.outcome]}`}>
                      {outcomeLabels[call.outcome]}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(call.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-500">
                    {call.duration && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(call.duration)}
                      </span>
                    )}
                    <span>by {call.salesRep.firstName} {call.salesRep.lastName}</span>
                  </div>
                  {call.notes && (
                    <div className="flex items-start gap-1 text-xs text-gray-600">
                      <FileText className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      <span>{call.notes}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      <LogCallModal
        isOpen={isLogCallOpen}
        onClose={() => setIsLogCallOpen(false)}
        onSuccess={fetchCalls}
        customerId={customerId}
        customerName={customerName}
        orderId={orderId}
      />
    </>
  );
};
