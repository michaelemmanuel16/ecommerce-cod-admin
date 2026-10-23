import type { Notification } from '../../types';
import { formatCurrency } from '../../utils/format';

interface OverdueAgent {
  agentName?: string;
  totalBalance?: string | number;
  criticalAmount?: string | number;
}

const age = (a: OverdueAgent): string => (Number(a.criticalAmount) > 0 ? '8+ days' : '4-7 days');

/**
 * What the bell shows for a row. The server stores a sentence for the log; for overdue collections the sentence
 * reads badly ("... totaling GHS 232030.00: Logiswift Delivery: GHS 232030.00"), so it is built again from the
 * row's own data. Any other row, or one without that data, keeps its stored words.
 */
export function notificationText(n: Pick<Notification, 'title' | 'message' | 'data'> & { type: string }): { title: string; message: string } {
  if (n.type !== 'overdue_collections') return { title: n.title, message: n.message };
  const agents: OverdueAgent[] = Array.isArray(n.data?.agents) ? n.data.agents : [];
  if (agents.length === 0) return { title: n.title, message: n.message };
  const money = (v: unknown) => formatCurrency(Number(v), 'GHS');
  const message = agents.length === 1
    ? `${agents[0].agentName ?? 'A delivery partner'} owes ${money(agents[0].totalBalance)}, unpaid for ${age(agents[0])}`
    : `${agents.length} delivery partners owe ${money(n.data?.totalOverdue ?? agents.reduce((sum, a) => sum + Number(a.totalBalance), 0))} in total`;
  return { title: 'Overdue cash collections', message };
}
