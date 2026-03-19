import React, { useState } from 'react';
import { Phone, CheckCircle, Loader2 } from 'lucide-react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { WABAPhoneNumber } from '../../../services/admin.service';

interface WhatsAppPhonePickerModalProps {
  phones: WABAPhoneNumber[];
  onSelect: (phone: WABAPhoneNumber) => void;
  onClose: () => void;
  loading?: boolean;
}

export const WhatsAppPhonePickerModal: React.FC<WhatsAppPhonePickerModalProps> = ({
  phones,
  onSelect,
  onClose,
  loading = false,
}) => {
  const [selectedId, setSelectedId] = useState<string>(phones.length === 1 ? phones[0].id : '');

  const handleConfirm = () => {
    const phone = phones.find(p => p.id === selectedId);
    if (phone) onSelect(phone);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Select WhatsApp Number" size="sm">
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {phones.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            No WhatsApp phone numbers found on your Meta Business account.
          </p>
        ) : (
          phones.map((phone) => (
            <label
              key={phone.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedId === phone.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="phone"
                value={phone.id}
                checked={selectedId === phone.id}
                onChange={() => setSelectedId(phone.id)}
                className="sr-only"
              />
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                selectedId === phone.id ? 'border-blue-500' : 'border-gray-300'
              }`}>
                {selectedId === phone.id && (
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                )}
              </div>
              <Phone className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {phone.verified_name}
                </p>
                <p className="text-xs text-gray-500">
                  {phone.display_phone_number}
                </p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                phone.quality_rating === 'GREEN'
                  ? 'bg-green-100 text-green-700'
                  : phone.quality_rating === 'YELLOW'
                  ? 'bg-yellow-100 text-yellow-700'
                  : phone.quality_rating === 'RED'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {phone.quality_rating}
              </span>
            </label>
          ))
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleConfirm}
          disabled={!selectedId || loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Connect Number
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
};
