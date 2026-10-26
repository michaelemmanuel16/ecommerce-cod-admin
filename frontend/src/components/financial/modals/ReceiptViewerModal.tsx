import React from 'react';
import { X } from 'lucide-react';
import { isPdfUrl, isSafeReceiptUrl } from '../../../utils/expenseRules';

interface ReceiptViewerModalProps {
  url: string | null;
  onClose: () => void;
}

/** Shows a receipt in the same tab (no new window: in-app browsers lose the tab). */
export const ReceiptViewerModal: React.FC<ReceiptViewerModalProps> = ({ url, onClose }) => {
  if (!isSafeReceiptUrl(url)) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Receipt">
      <div className="absolute inset-0 bg-black bg-opacity-60" onClick={onClose}></div>
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Receipt</h2>
          <button onClick={onClose} aria-label="Close receipt" className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {isPdfUrl(url)
            ? <iframe title="Receipt PDF" src={url} className="w-full h-[70vh] border-0" />
            : <img src={url} alt="Receipt" className="max-w-full mx-auto" />}
        </div>
      </div>
    </div>
  );
};
