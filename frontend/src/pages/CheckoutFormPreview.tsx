import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckoutForm } from '../components/public/CheckoutForm';
import { PublicCheckoutForm } from '../services/public-orders.service';
import { checkoutFormsService } from '../services/checkout-forms.service';

type PreviewMessage = {
  type: 'checkout-preview-update';
  patch: Partial<PublicCheckoutForm>;
};

const isPreviewMessage = (data: any): data is PreviewMessage =>
  data && data.type === 'checkout-preview-update' && data.patch && typeof data.patch === 'object';

/**
 * Admin-only preview route. Mounted inside the editor's preview iframe.
 * 1. Loads the persisted form via /preview-config (allows inactive forms).
 * 2. Listens for `checkout-preview-update` postMessages from the parent
 *    editor window and merges the patch into the rendered form data so
 *    in-flight unsaved edits show live without a save round-trip.
 */
export const CheckoutFormPreview: React.FC = () => {
  const { id: idParam } = useParams<{ id: string }>();
  const formId = idParam ? Number(idParam) : null;

  const [baseForm, setBaseForm] = useState<PublicCheckoutForm | null>(null);
  const [patch, setPatch] = useState<Partial<PublicCheckoutForm>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (formId === null || isNaN(formId)) {
      setError('Invalid preview URL');
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const form = await checkoutFormsService.getCheckoutFormPreviewConfig(formId);
        if (!cancelled) setBaseForm(form as PublicCheckoutForm);
      } catch (err: any) {
        if (cancelled) return;
        console.error('Failed to load preview:', err);
        setError(err?.response?.data?.message || 'Failed to load preview');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  // Listen for parent editor draft updates.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isPreviewMessage(event.data)) return;
      setPatch(event.data.patch);
    };
    window.addEventListener('message', handler);
    // Tell parent we're ready so it can replay its current draft.
    window.parent?.postMessage({ type: 'checkout-preview-ready' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const merged = useMemo<PublicCheckoutForm | null>(() => {
    if (!baseForm) return null;
    return { ...baseForm, ...patch };
  }, [baseForm, patch]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-gray-800 mb-3" />
          <p className="text-sm text-gray-600">Loading preview…</p>
        </div>
      </div>
    );
  }

  if (error || !merged) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="max-w-sm w-full bg-white border border-red-200 text-red-800 rounded-lg p-4 text-sm">
          {error || 'Preview unavailable'}
        </div>
      </div>
    );
  }

  return (
    <CheckoutForm
      formData={merged}
      onSubmit={async () => {
        // No-op in preview mode — never submits an order.
      }}
    />
  );
};
