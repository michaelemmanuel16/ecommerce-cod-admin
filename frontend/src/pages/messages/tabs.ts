import { MessageCircle, type LucideIcon } from 'lucide-react';

export type TabKey = 'conversations';

export interface MessagesTab {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

// Templates and Opt-outs come in the next wave: they are not listed.
export const TABS: MessagesTab[] = [
  { key: 'conversations', label: 'Conversations', icon: MessageCircle },
];
