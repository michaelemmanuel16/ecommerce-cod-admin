import type { PublicCheckoutForm } from '../services/public-orders.service';
import { DEFAULT_BUTTON_COLOR } from './contrast';

type Design = PublicCheckoutForm['design'];

/** The form's primary colour and page background for the small screens (success, not available, callback). */
export function screenColors(design?: Design): { primary: string; background?: string } {
  const colors = design?.colors || {};
  const background = design?.page?.background;
  return {
    primary: colors.primary || colors.cta || DEFAULT_BUTTON_COLOR,
    background: background && background !== 'transparent' ? background : undefined,
  };
}

/** wa.me link for a stored support number ("+233 24 555 0103" gives https://wa.me/233245550103). Null when there are no digits. */
export function whatsappLink(number?: string | null): string | null {
  const digits = (number || '').replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : null;
}

