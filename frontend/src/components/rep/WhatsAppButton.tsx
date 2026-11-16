import React from 'react';
import { MessageCircle } from 'lucide-react';
import { useRepChat } from './RepChatPanel';

interface Props {
  orderId: number;
  customerName: string;
  /** `text` shows the word beside the icon (the call card); `icon` is the round button of a row. */
  variant?: 'icon' | 'text';
  className?: string;
  title?: string;
  testId?: string;
  iconSize?: number;
}

/**
 * The rep's WhatsApp button. It opens the customer's chat in a panel over the current page (the rep stays on the order),
 * sent from the business number. It is always clickable; with no WhatsApp connection the panel shows the history and
 * disables the reply box. It never opens wa.me or the rep's own WhatsApp.
 */
export const WhatsAppButton: React.FC<Props> = ({ orderId, customerName, variant = 'icon', className, title = 'WhatsApp customer', testId, iconSize = 15 }) => {
  const { openOrderChat } = useRepChat();
  return (
    <button type="button" className={className} title={title} aria-label={`WhatsApp ${customerName}`} data-testid={testId} onClick={() => openOrderChat(orderId)}>
      <MessageCircle aria-hidden="true" size={iconSize} style={{ width: iconSize, height: iconSize }} />
      {variant === 'text' ? <> WhatsApp</> : null}
    </button>
  );
};

export default WhatsAppButton;
