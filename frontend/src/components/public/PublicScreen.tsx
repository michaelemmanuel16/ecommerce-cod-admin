import React from 'react';
import type { PublicCheckoutForm } from '../../services/public-orders.service';
import { screenColors } from '../../lib/publicTheme';
import { whatsappUrl } from '../../utils/whatsapp';

type Design = PublicCheckoutForm['design'];

interface PublicScreenProps {
  design?: Design;
  /** Inside the embed widget: no full-height page chrome. */
  embedded?: boolean;
  children: React.ReactNode;
}

/** A centred card on the form's colours. It keeps its own light palette: it never reads the admin theme. */
export const PublicScreen: React.FC<PublicScreenProps> = ({ design, embedded, children }) => {
  const { background } = screenColors(design);
  return (
    <div
      className={embedded ? 'w-full py-6 px-4' : 'min-h-screen bg-gray-50 flex items-center justify-center py-8 px-4'}
      data-testid="public-form-root"
      style={{ colorScheme: 'light', ...(background ? { backgroundColor: background } : {}) }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-gray-200 p-6 text-center">{children}</div>
    </div>
  );
};

/** A tinted circle with an icon on top of a screen. `tint` and the icon's own colour come from the caller. */
export const StatusIcon: React.FC<{ tint: string; children: React.ReactNode }> = ({ tint, children }) => (
  <div className="flex justify-center mb-4">
    <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: tint }}>{children}</div>
  </div>
);

/** "Questions? Message us on WhatsApp." Same tab, so the Facebook in-app browser keeps the page. Hidden when the store has no number. */
export const SupportLine: React.FC<{ supportWhatsapp?: string | null; color?: string; lead?: string }> = ({ supportWhatsapp, color, lead = 'Questions?' }) => {
  const href = whatsappUrl(supportWhatsapp);
  if (!href) return null;
  return (
    <p className="text-sm text-gray-600 mt-6">
      {lead}{' '}
      <a href={href} className="font-semibold underline" style={color ? { color } : undefined}>
        Message us on WhatsApp
      </a>
    </p>
  );
};
