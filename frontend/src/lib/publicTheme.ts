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
