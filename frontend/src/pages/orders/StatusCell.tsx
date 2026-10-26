import type { ReactNode } from 'react';
import { Bell, MessageSquare, Sparkles } from 'lucide-react';
import { Tag } from '../../components/ui-v2';
import type { OrderListRow, UnpaidOrderRow } from '../../services/orders.service';
import { ORDER_STATUS_LABELS } from '../../utils/orderStatus';
import { STATUS_TONE, shortDate } from './model';

/**
 * Tag, then the flag line, then the reminder and reply chips (F-307, the .stc cell of the mockup).
 * `tag` replaces the plain tag, for example with the button that opens the move menu (F-313).
 */
export function StatusCell({ row, tag }: { row: OrderListRow; tag?: ReactNode }) {
  const [flag, ...moreFlags] = row.flags ?? [];
  const replies = row.threadCount ?? 0;
  const reminder = row.reminder?.dueAt ? shortDate(row.reminder.dueAt) : null;
  return (
    <div className="stc">
      {tag ?? <Tag tone={STATUS_TONE[row.status]}>{ORDER_STATUS_LABELS[row.status]}</Tag>}
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
    </div>
  );
}

/** The tag slot of the status cell on the Unpaid by agent view: the plain tag and how long the cash has waited. */
export function UnpaidTag({ row }: { row: UnpaidOrderRow }) {
  // the rows of the previous tab can show for one render after the switch: they have no `unpaid` yet
  const { days, daysToPay } = row.unpaid ?? { days: null, daysToPay: null };
  return (
    <>
      <Tag tone={STATUS_TONE[row.status]}>{ORDER_STATUS_LABELS[row.status]}</Tag>
      {days !== null && (
        <div className="unpaidline">
          Unpaid {days} {days === 1 ? 'day' : 'days'}{daysToPay !== null && `, pays in ${daysToPay}`}
        </div>
      )}
    </>
  );
}
