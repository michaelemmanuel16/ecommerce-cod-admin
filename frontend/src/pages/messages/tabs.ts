import { BarChart3, FileText, List, Megaphone, MessageCircle, Send, type LucideIcon } from 'lucide-react';

export type TabKey = 'overview' | 'conversations' | 'log' | 'bulk' | 'campaigns' | 'templates';

export interface MessagesTab {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

// Bulk send is for owner and admin (the API allows only them); the page drops it for anyone else.
// Templates: owner, admin and manager read them, owner and admin change them (the tab hides the write controls).
export const TABS: MessagesTab[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'conversations', label: 'Conversations', icon: MessageCircle },
  { key: 'log', label: 'Message log', icon: List },
  { key: 'bulk', label: 'Bulk send', icon: Send },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone },
  { key: 'templates', label: 'Templates', icon: FileText },
];
