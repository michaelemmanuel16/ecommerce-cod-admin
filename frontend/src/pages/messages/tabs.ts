import { Megaphone, MessageCircle, Send, type LucideIcon } from 'lucide-react';

export type TabKey = 'conversations' | 'bulk' | 'campaigns';

export interface MessagesTab {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

// Bulk send is for owner and admin (the API allows only them); the page drops it for anyone else.
// Templates and Opt-outs come in the next wave: they are not listed.
export const TABS: MessagesTab[] = [
  { key: 'conversations', label: 'Conversations', icon: MessageCircle },
  { key: 'bulk', label: 'Bulk send', icon: Send },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
];
