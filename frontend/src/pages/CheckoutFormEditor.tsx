import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Loading } from '../components/ui/Loading';
import {
  CheckoutFormBuilder,
  CheckoutFormBuilderHandle,
} from '../components/forms/CheckoutFormBuilder';
import { CheckoutFormPreviewPane } from '../components/forms/CheckoutFormPreviewPane';
import { CopyURLButton, CopyEmbedButton } from '../components/forms/CopyActions';
import { CheckoutForm } from '../types/checkout-form';
import { Product } from '../types';
import { checkoutFormsService } from '../services/checkout-forms.service';
import { productsService } from '../services/products.service';

const UNSAVED_PROMPT = 'You have unsaved changes. Discard them?';

export const CheckoutFormEditor: React.FC = () => {
  const navigate = useNavigate();
  const { id: idParam } = useParams<{ id: string }>();
  const isCreateMode = !idParam || idParam === 'new';
  const formId = isCreateMode ? null : Number(idParam);

  const builderRef = useRef<CheckoutFormBuilderHandle>(null);
  const [initialForm, setInitialForm] = useState<CheckoutForm | undefined>();
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const productsPromise = productsService.getProducts();
        if (formId !== null) {
          const [form, prods] = await Promise.all([
            checkoutFormsService.getCheckoutForm(formId),
            productsPromise,
          ]);
          if (cancelled) return;
          setInitialForm(form);
          setProducts(prods);
        } else {
          const prods = await productsPromise;
          if (cancelled) return;
          setInitialForm(undefined);
          setProducts(prods);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('Failed to load editor data:', err);
        setLoadError(
          err?.response?.data?.message ||
            'Failed to load checkout form. Please try again.'
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [formId]);

  // Browser-level (tab close / hard refresh / external link / browser back) guard.
  // We don't use react-router's useBlocker because it requires a data router and
  // this app uses the legacy <BrowserRouter>. In-app navigation through our own
  // Back button is guarded explicitly in handleBack below.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty || isSubmitting) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty, isSubmitting]);

  const handleSave = useCallback(
    async (data: Partial<CheckoutForm>) => {
      if (formId !== null) {
        const updated = await checkoutFormsService.updateCheckoutForm(formId, data);
        setInitialForm(updated);
      } else {
        const created = await checkoutFormsService.createCheckoutForm(data);
        navigate(`/checkout-forms/${created.id}/edit`, { replace: true });
      }
    },
    [formId, navigate]
  );

  const handleBack = () => {
    if (isDirty && !isSubmitting && !window.confirm(UNSAVED_PROMPT)) return;
    navigate('/checkout-forms');
  };

  if (isLoading) {
    return (
      <div className="py-16">
        <Loading />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button variant="secondary" size="sm" onClick={handleBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to forms
        </Button>
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4">
          {loadError}
        </div>
      </div>
    );
  }

  const title = isCreateMode
    ? 'Create Checkout Form'
    : initialForm?.name || 'Edit Checkout Form';

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between gap-3 flex-none pb-3 border-b border-gray-200">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="secondary" size="sm" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            {title}
          </h1>
          {isDirty && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {initialForm?.slug && (
            <>
              <CopyURLButton form={initialForm} />
              <CopyEmbedButton form={initialForm} />
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsPreviewOpen((v) => !v)}
            title={isPreviewOpen ? 'Hide preview' : 'Show preview'}
          >
            {isPreviewOpen ? (
              <EyeOff className="w-4 h-4 mr-1" />
            ) : (
              <Eye className="w-4 h-4 mr-1" />
            )}
            Preview
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => builderRef.current?.submit()}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Saving…' : isCreateMode ? 'Create form' : 'Save'}
          </Button>
        </div>
      </div>

      <div
        className={
          isPreviewOpen
            ? 'flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] gap-6 pt-4'
            : 'flex-1 min-h-0 pt-4'
        }
      >
        {/* Editor column scrolls independently of the preview. */}
        <div className="min-w-0 overflow-y-auto pr-1">
          <CheckoutFormBuilder
            ref={builderRef}
            initialData={initialForm}
            products={products}
            onSave={handleSave}
            onDirtyChange={setIsDirty}
            onSubmittingChange={setIsSubmitting}
            onDraftChange={setDraft}
          />
        </div>
        {/* Preview column: the iframe scrolls its own content internally. */}
        {isPreviewOpen && (
          <div className="hidden lg:block overflow-hidden">
            <CheckoutFormPreviewPane formId={formId} draft={draft} />
          </div>
        )}
      </div>
    </div>
  );
};
