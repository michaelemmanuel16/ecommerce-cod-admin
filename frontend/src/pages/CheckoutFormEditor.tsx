import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useBlocker } from 'react-router-dom';
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

  // In-app navigation guard
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    isDirty && !isSubmitting && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm(UNSAVED_PROMPT)) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker]);

  // Browser-level (tab close / hard refresh / external link) guard
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
        await checkoutFormsService.updateCheckoutForm(formId, data);
        const refreshed = await checkoutFormsService.getCheckoutForm(formId);
        setInitialForm(refreshed);
      } else {
        const created = await checkoutFormsService.createCheckoutForm(data);
        navigate(`/checkout-forms/${created.id}/edit`, { replace: true });
      }
    },
    [formId, navigate]
  );

  const handleBack = () => navigate('/checkout-forms');

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 sticky top-0 bg-gray-50 z-20 py-3 -mt-3">
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
          {formId !== null && (
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
          )}
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
          isPreviewOpen && formId !== null
            ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,500px)] gap-6 items-start'
            : ''
        }
      >
        <div className="min-w-0">
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
        {isPreviewOpen && formId !== null && (
          <div className="hidden lg:block sticky top-20 h-[calc(100vh-7rem)]">
            <CheckoutFormPreviewPane formId={formId} draft={draft} />
          </div>
        )}
      </div>
    </div>
  );
};
