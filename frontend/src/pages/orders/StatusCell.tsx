import { Bell, MessageSquare, Sparkles } from 'lucide-react';
import { Tag } from '../../components/ui-v2';
import type { OrderListRow } from '../../services/orders.service';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { STATUS_TONE, shortDate } from './model';

/** Tag, then the flag line, then the reminder and reply chips (F-307, the .stc cell of the mockup). */
export function StatusCell({ row }: { row: OrderListRow }) {
  const [flag, ...moreFlags] = row.flags ?? [];
  const replies = row.threadCount ?? 0;
  const reminder = row.reminder?.dueAt ? shortDate(row.reminder.dueAt) : null;
  return (
    <>
      <Tag tone={STATUS_TONE[row.status]}>{ORDER_STATUS_LABELS[row.status]}</Tag>
      {flag && (
        <div className="flag">
          <Sparkles />
          {flag.label}
          {moreFlags.length > 0 && ` +${moreFlags.length}`}
        </div>
      )}
      {(reminder || replies > 0) && (
        <div className="chips">
          {reminder && (
            <span className="chip v">
              <Bell />
              Reminder {reminder}
            </span>
          )}
          {replies > 0 && (
            <span className="chip">
              <MessageSquare />
              {replies} {replies === 1 ? 'reply' : 'replies'}
            </span>
          )}
        </div>
      )}
    </>
  );
}
