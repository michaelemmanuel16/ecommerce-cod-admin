import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { billingService } from '../services/billing.service';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

/**
 * SaaS subscription callback (MAN-61) — Paystack redirects here after the
 * tenant pays. Verifies the transaction, binds the subscription, then returns to
 * the billing page. Mirrors the buyer PaymentCallback shape.
 */
export const SubscriptionCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'failed'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const reference = searchParams.get('reference') || searchParams.get('trxref');
    if (!reference) {
      setStatus('failed');
      setMessage('No payment reference found.');
      return;
    }

    billingService
      .verifySubscription(reference)
      .then((res) => {
        if (res.status === 'active') {
          setStatus('success');
          // Brief confirmation, then back to billing where the live state shows.
          setTimeout(() => navigate('/settings/billing'), 1800);
        } else {
          setStatus('failed');
          setMessage('We could not confirm your subscription. Please try again.');
        }
      })
      .catch(() => {
        setStatus('failed');
        setMessage('Unable to verify your subscription. If you were charged, contact support.');
      });
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-16 h-16 text-primary-500 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Activating your subscription</h2>
            <p className="text-gray-600">Please wait a moment...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-3">You're all set</h2>
            <p className="text-gray-600">Your plan is active. Taking you to billing...</p>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-10 h-10 text-red-500" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Subscription Issue</h2>
            <p className="text-gray-600 mb-6">{message}</p>
            <button
              onClick={() => navigate('/settings/billing')}
              className="w-full py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700"
            >
              Back to billing
            </button>
          </>
        )}
      </div>
    </div>
  );
};
