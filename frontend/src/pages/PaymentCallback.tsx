import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, Loader2, SearchX } from 'lucide-react';
import { publicOrdersService, type PaymentOutcome, type PublicCheckoutForm } from '../services/public-orders.service';
import { PublicScreen, StatusIcon, SupportLine } from '../components/public/PublicScreen';
import { screenColors } from '../lib/publicTheme';
import { POLL_MS, POLL_LIMIT_MS, REDIRECT_DELAY_MS } from '../lib/paymentPolling';

type View = 'confirming' | 'pending' | 'stalled' | 'success' | 'failed' | 'not_found';

interface FormTheme {
  design?: PublicCheckoutForm['design'];
  supportWhatsapp?: string | null;
}

/** Colours and support number of the form the payment belongs to. A form that is switched off still gives its support number (404 body). */
async function loadTheme(slug: string): Promise<FormTheme> {
  try {
    const form = await publicOrdersService.getPublicForm(slug);
    return { design: form.design, supportWhatsapp: form.supportWhatsapp };
  } catch (err: any) {
    return { supportWhatsapp: err?.response?.data?.supportWhatsapp ?? null };
  }
}

export const PaymentCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get('reference') || searchParams.get('trxref');
  // The checkout adds ?form=<slug> to the callback URL it gives the provider, so the page knows the store even when the
  // reference is unknown.
  const formParam = searchParams.get('form');
  const [view, setView] = useState<View>(reference ? 'confirming' : 'not_found');
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const [theme, setTheme] = useState<FormTheme>({});
  const slug = outcome?.formSlug ?? formParam;

  // Colours and support number of the form the payment belongs to.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    loadTheme(slug).then((t) => { if (!cancelled) setTheme(t); });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    const check = async () => {
      let result: PaymentOutcome | null = null;
      try {
        result = await publicOrdersService.verifyPayment(reference);
      } catch {
        result = null; // network trouble or a busy server: treat as not confirmed yet and keep asking
      }
      if (cancelled) return;
      if (result) {
        setOutcome(result);
        if (result.status === 'success') return setView('success');
        if (result.status === 'failed') return setView('failed');
        if (result.status === 'not_found') return setView('not_found');
      }
      if (Date.now() - startedAt >= POLL_LIMIT_MS) return setView('stalled');
      setView('pending');
      timer = setTimeout(check, POLL_MS);
    };
    check();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reference]);

  // A form with its own thank-you page: the server built the URL (same details as a COD order); leave for it.
  useEffect(() => {
    if (view !== 'success' || !outcome?.redirectUrl) return;
    const url = outcome.redirectUrl;
    const timer = setTimeout(() => { window.location.href = url; }, REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [view, outcome]);

  const { primary } = screenColors(theme.design);
  const icon = (node: React.ReactNode, tint: string) => <StatusIcon tint={tint}>{node}</StatusIcon>;

  return (
    <PublicScreen design={theme.design}>
      {view === 'confirming' && (
        <>
          {icon(<Loader2 className="w-9 h-9 animate-spin" style={{ color: primary }} aria-hidden="true" />, `${primary}1a`)}
          <h1 className="text-xl font-bold text-gray-900">Confirming your payment. Please wait.</h1>
        </>
      )}

      {view === 'pending' && (
        <>
          {icon(<Clock className="w-9 h-9" style={{ color: primary }} aria-hidden="true" />, `${primary}1a`)}
          <h1 className="text-xl font-bold text-gray-900">We are waiting for your payment to be confirmed.</h1>
          <p className="text-sm text-gray-600 mt-2">Keep this page open. It updates by itself.</p>
        </>
      )}

      {view === 'stalled' && (
        <>
          {icon(<Clock className="w-9 h-9 text-amber-600" aria-hidden="true" />, '#fef3c7')}
          <h1 className="text-xl font-bold text-gray-900">We have not received your payment yet.</h1>
          <p className="text-sm text-gray-600 mt-2">
            If you were charged, your order will appear within a few minutes. Your reference is <span className="font-mono font-semibold">{reference}</span>.
          </p>
          <SupportLine supportWhatsapp={theme.supportWhatsapp} color={primary} />
        </>
      )}

      {view === 'success' && (
        <>
          {icon(<CheckCircle className="w-9 h-9" style={{ color: primary }} aria-hidden="true" />, `${primary}1a`)}
          <h1 className="text-2xl font-bold text-gray-900">Order received.</h1>
          {outcome?.orderNumber && (
            <p className="text-gray-700 mt-2">
              Your order number is <span className="font-bold font-mono" style={{ color: primary }} data-testid="order-number">{outcome.orderNumber}</span>.
            </p>
          )}
          {outcome?.orderType === 'digital' && (
            <p className="text-sm text-gray-700 mt-3">
              {outcome.email ? `We sent the download link to ${outcome.email}.` : 'We sent the download link to your email.'}
            </p>
          )}
        </>
      )}

      {view === 'failed' && (
        <>
          {icon(<XCircle className="w-9 h-9 text-red-600" aria-hidden="true" />, '#fee2e2')}
          <h1 className="text-xl font-bold text-gray-900">The payment did not go through.</h1>
          {outcome?.formSlug && (
            // Same tab: the Facebook in-app browser loses a new one.
            <a
              href={`/form/${outcome.formSlug}`}
              className="mt-5 inline-block w-full rounded-lg py-3 font-semibold text-white"
              style={{ backgroundColor: primary }}
            >
              Try again
            </a>
          )}
          <p className="text-sm text-gray-600 mt-4">
            If you were charged, send us your reference <span className="font-mono font-semibold">{reference}</span>.
          </p>
          <SupportLine supportWhatsapp={theme.supportWhatsapp} color={primary} />
        </>
      )}

      {view === 'not_found' && (
        <>
          {icon(<SearchX className="w-9 h-9 text-gray-500" aria-hidden="true" />, '#f3f4f6')}
          <h1 className="text-xl font-bold text-gray-900">We could not find this payment.</h1>
          <p className="text-sm text-gray-600 mt-2">Check the link or contact us.</p>
          <SupportLine supportWhatsapp={theme.supportWhatsapp} color={primary} />
        </>
      )}
    </PublicScreen>
  );
};
