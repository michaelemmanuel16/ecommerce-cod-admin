import { useState } from 'react';
import { Modal } from '../../components/ui-v2';
import { DeviceToggle, PreviewFrame } from '../../components/forms/PreviewFrame';
import type { PreviewDevice } from '../../lib/previewWidth';
import type { CheckoutForm } from '../../types/checkout-form';

/** The list's Preview (F-419): the saved form as the buyer sees it, in the same preview route the editor uses. */
export function PreviewModal({ form, onClose }: { form: CheckoutForm | null; onClose: () => void }) {
  const [device, setDevice] = useState<PreviewDevice>('mobile');
  if (!form) return null;
  return (
    <Modal open onClose={onClose} title={form.name || 'Preview'} description="Preview only. No order is placed from here.">
      <div style={{ display: 'grid', gap: 12 }}>
        <DeviceToggle device={device} onChange={setDevice} />
        <PreviewFrame src={`/checkout-forms/${form.id}/preview`} device={device} height={560} />
      </div>
    </Modal>
  );
}
