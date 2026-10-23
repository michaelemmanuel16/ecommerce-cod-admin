import React, { useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import { PixelConfig } from '../../types/checkout-form';
import type { PublicCheckoutForm } from '../../services/public-orders.service';
import { trackPurchase } from '../../utils/pixelTracking';
import { PublicScreen, StatusIcon, SupportLine } from './PublicScreen';
import { screenColors } from '../../lib/publicTheme';

interface OrderSuccessProps {
  orderId?: number;
  /** The order number as the server prints it ("#24118"). Falls back to "#<orderId>". */
  orderNumber?: string;
  /** A repeat of an order already placed: the Purchase event fired the first time, so it does not fire again. */
  repeatOrder?: boolean;
  orderTotal?: number;
  currency?: string;
  pixelConfig?: PixelConfig;
  /** Digital order: the next-step list says the download link was sent. */
  digital?: boolean;
  supportWhatsapp?: string | null;
  design?: PublicCheckoutForm['design'];
  embedded?: boolean;
}

export const OrderSuccess: React.FC<OrderSuccessProps> = ({
  orderId, orderNumber, repeatOrder, orderTotal, currency = 'USD', pixelConfig,
  digital, supportWhatsapp, design, embedded,
}) => {
  useEffect(() => {
    if (pixelConfig && !repeatOrder) {
      trackPurchase(pixelConfig, orderTotal ?? 0, currency, orderId);
    }
  }, []); // intentionally empty — fires once on mount

  const { primary } = screenColors(design);
  const number = orderNumber || (orderId != null ? `#${orderId}` : null);
  const steps = digital
    ? ['We sent the download link to your email.']
    : ['We call you to confirm your order.', 'We deliver to you.', 'You pay when it arrives.'];

  return (
    <PublicScreen design={design} embedded={embedded}>
      <StatusIcon tint={`${primary}1a`}>
        <CheckCircle className="w-9 h-9" style={{ color: primary }} aria-hidden="true" />
      </StatusIcon>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Order placed</h1>
      {number && (
        <p className="text-3xl font-bold font-mono mb-1" style={{ color: primary }} data-testid="order-number">
          {number}
        </p>
      )}

      <div className="text-left mt-6">
        <h2 className="font-semibold text-gray-900 mb-2">What happens next</h2>
        <ul className="space-y-2 text-sm text-gray-700">
          {steps.map((step) => (
            <li key={step} className="flex items-start">
              <span className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 mr-2 flex-shrink-0" style={{ backgroundColor: primary }} />
              <span>{step}</span>
            </li>
          ))}
          {/* Auto-confirm line ("We sent you a message on WhatsApp. Reply to confirm.") goes here once the tenant setting exists (file 05, F-466). */}
        </ul>
      </div>

      <SupportLine supportWhatsapp={supportWhatsapp} color={primary} />
    </PublicScreen>
  );
};
