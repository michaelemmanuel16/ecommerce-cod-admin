import { Tag } from '../../../components/ui-v2';
import type { OrderStatus } from '../../../types';
import type { TimelineEntry } from '../../../services/orders.service';
import { accraTime } from './model';

const BAD: OrderStatus[] = ['failed_delivery', 'returned', 'cancelled', 'payment_failed'];

const FIELD_WORDS: Record<string, string> = {
  customerName: 'name', customerEmail: 'email', customerPhone: 'phone', alternatePhone: 'alternate phone',
  deliveryAddress: 'address', deliveryState: 'state', deliveryArea: 'city/town', orderItems: 'items', totalAmount: 'total',
};

/** Who did it, in words: "Adwoa Darko", "AI agent", "Partner", "System". */
function who(a: TimelineEntry['actor']): string {
  if (!a) return '';
  if (a.kind === 'person') return a.name ?? 'A teammate';
  if (a.kind === 'ai_agent') return a.name ? `${a.name} (AI agent)` : 'AI agent';
  if (a.kind === 'partner') return a.name ? `${a.name} (partner)` : 'Partner';
  return 'System';
}

function titleOf(e: TimelineEntry): string {
  if (e.kind === 'edit' && e.title.startsWith('Edited ')) {
    const fields = e.title.slice(7).split(', ').map((f) => FIELD_WORDS[f] ?? f).join(', ');
    return `Edited by ${e.actor?.name?.split(' ')[0] || who(e.actor) || 'a teammate'}: ${fields}`;
  }
  // "Confirmed by Adwoa Darko": a move that names its person, AI agent, partner or the system
  if (e.kind === 'status' && e.actor) return `${e.title} by ${who(e.actor)}`;
  return e.title;
}

/** The order timeline (F-322): main rows for the placing and each move, smaller rows for edits, assignments and calls. */
export function Timeline({ entries, sourceLabel }: { entries: TimelineEntry[] | 'error' | null; sourceLabel?: string }) {
  if (entries === null) return <p className="hint">Loading the timeline…</p>;
  if (entries === 'error') return <p className="hint">The timeline could not load.</p>;
  return (
    <ul className="tl">
      {entries.map((e, n) => {
        const small = e.size === 'small';
        const future = e.kind === 'planned';
        const bad = e.status !== undefined && BAD.includes(e.status);
        return (
          <li key={`${e.at}-${n}`} className={[small && 'small', future && 'future'].filter(Boolean).join(' ') || undefined}>
            <i className={['d', bad && 'bad', future && 'plan'].filter(Boolean).join(' ')} />
            <div>
              <div className="row">
                <b>{titleOf(e)}</b>
                {e.override && <Tag tone="v">Override</Tag>}
                {e.durationChip && <span className="chip">{e.durationChip}</span>}
              </div>
              <small>
                {e.kind === 'placed' && sourceLabel ? `${sourceLabel}, ` : ''}
                {accraTime(e.at)}
                {e.actor && e.actor.kind !== 'person' && e.kind !== 'status' ? `, ${who(e.actor)}` : ''}
              </small>
              {e.override && e.reason && <small>Reason: {e.reason}</small>}
              {!e.override && e.note && <small>{e.note}</small>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
