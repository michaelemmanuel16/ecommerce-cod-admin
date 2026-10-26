import React from 'react';
import { Modal } from '../../ui/Modal';
import { isPdfUrl, isSafeReceiptUrl } from '../../../utils/expenseRules';

interface ReceiptViewerModalProps {
  url: string | null;
  onClose: () => void;
}

/** Shows a receipt in the same tab (no new window: in-app browsers lose the tab). */
export const ReceiptViewerModal: React.FC<ReceiptViewerModalProps> = ({ url, onClose }) => (
  <Modal closeOnEscape isOpen={isSafeReceiptUrl(url)} onClose={onClose} title="Receipt" size="xl">
    {isSafeReceiptUrl(url) && (isPdfUrl(url)
      ? <iframe title="Receipt PDF" src={url} className="w-full h-[70vh] border-0" />
      : <img src={url} alt="Receipt" className="max-w-full mx-auto" />)}
  </Modal>
);
