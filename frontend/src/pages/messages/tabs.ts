import { BarChart3, List, Megaphone, MessageCircle, Send, type LucideIcon } from 'lucide-react';

export type TabKey = 'overview' | 'conversations' | 'log' | 'bulk' | 'campaigns';

export interface MessagesTab {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

// Bulk send is for owner and admin (the API allows only them); the page drops it for anyone else.
// Templates and Opt-outs come in the next wave: they are not listed.
export const TABS: MessagesTab[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'conversations', label: 'Conversations', icon: MessageCircle },
  { key: 'log', label: 'Message log', icon: List },
  { key: 'bulk', label: 'Bulk send', icon: Send },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
];
