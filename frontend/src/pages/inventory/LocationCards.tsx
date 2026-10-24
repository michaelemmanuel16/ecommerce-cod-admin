import { Clock, Plus, Store, User, Warehouse, type LucideIcon } from 'lucide-react';
import { Button, Tag } from '../../components/ui-v2';
import type { LocationCard, StockLocationType } from '../../services/inventory.service';
import { ACTION_META, cardNote, countTag, HOLDER_ACTIONS, TYPE_LABEL, type StockAction } from './model';
import { count } from '../deliveries/model';

const ICON: Record<StockLocationType, { Icon: LucideIcon; tone: 'gold' | 'mint' | 'pine' }> = {
  partner_3pl: { Icon: Warehouse, tone: 'gold' },
  agent: { Icon: User, tone: 'mint' },
  own_store: { Icon: Store, tone: 'pine' },
};

interface LocationCardsProps {
  cards: LocationCard[];
  /** The person may move stock (products:update_stock): the card buttons and the own-store card show. */
  canMove: boolean;
  /** No own store yet: the dashed card offers to set one up. */
  offerOwnStore: boolean;
  onAction: (action: StockAction, locationId: number) => void;
  onSetUpStore: () => void;
}

/** One card per active location (F-652): on hand, reserved, products, in transit, and how our records compare with the latest count. */
export function LocationCards({ cards, canMove, offerOwnStore, onAction, onSetUpStore }: LocationCardsProps) {
  return (
    <div className="locs">
      {cards.map((card) => {
        const { Icon, tone } = ICON[card.type];
        const latest = card.latestCount;
        const tag = latest ? countTag({ isOld: latest.isOld, difference: -latest.unitsOff, wording: 'off' }) : null;
        const stats: Array<[string, number]> = [['On hand', card.onHand], ['Reserved', card.reserved], ['Products', card.products], ['In transit', card.inTransit]];
        return (
          <article key={card.id} className={tag?.tone === 'bad' ? 'card loc gap' : 'card loc'} aria-label={card.name}>
            <div className="top2">
              <div className={`ic ${tone}`}><Icon aria-hidden="true" /></div>
              <div>
                <b>{card.name}</b>
                <small>{TYPE_LABEL[card.type]}{card.address ? ` · ${card.address}` : ''}</small>
              </div>
              {tag && <Tag tone={tag.tone}>{tag.text}</Tag>}
            </div>
            <div className="stats">
              {stats.map(([label, value]) => (
                <div key={label} className="drv"><small>{label}</small><b className="num">{count(value)}</b></div>
              ))}
            </div>
            <div className="note"><Clock aria-hidden="true" />{cardNote(latest)}</div>
            {canMove && (
              <div className="tbtns">
                {HOLDER_ACTIONS[card.type].map((action) => (
                  <Button key={action} size="mini" onClick={() => onAction(action, card.id)}>{ACTION_META[action].label}</Button>
                ))}
              </div>
            )}
          </article>
        );
      })}
      {offerOwnStore && canMove && (
        <div className="card loc empty">
          <div className="top2"><div className="ic pine"><Store aria-hidden="true" /></div><div><b>Own store</b><small>Not set up</small></div></div>
          <p>Keep stock at your own shop or home? Add it as a location and count it like any other.</p>
          <Button onClick={onSetUpStore}><Plus />Set up own store</Button>
        </div>
      )}
    </div>
  );
}
