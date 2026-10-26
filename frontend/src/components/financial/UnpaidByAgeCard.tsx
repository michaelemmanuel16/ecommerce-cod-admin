import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { Button, Card, EmptyState, Skeleton } from '../ui-v2';
import { collectionsService, type UnpaidByAge } from '../../services/collections.service';
import { formatCurrency } from '../../utils/format';
import { BUCKET_COLOR, ordersText } from '../../pages/financial/collections/model';

/**
 * "Unpaid delivered orders, by age" (F-910, M5-T35): four buckets, net of the delivery fee. The overdue count is the same
 * number as the Orders "Unpaid by agent" tab (both come from agingService.overdueFilter). `reloadKey` reloads it after a change.
 */
export function UnpaidByAgeCard({ reloadKey = 0 }: { reloadKey?: number }) {
  const [data, setData] = useState<UnpaidByAge | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await collectionsService.unpaidByAge());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const title = 'Unpaid delivered orders';
  const aside = 'By age, net of delivery fee';
  if (failed && !data) {
    return (
      <Card title={title} aside={aside}>
        <EmptyState title="The unpaid orders could not load." action={<Button onClick={() => void load()}>Try again</Button>} />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title={title} aside={aside}>
        <div className="bars" aria-busy="true" aria-label="Loading unpaid orders">
          <Skeleton height={14} /><Skeleton height={14} /><Skeleton height={14} /><Skeleton height={14} />
        </div>
      </Card>
    );
  }
  if (data.total.orders === 0) {
    return (
      <Card title={title} aside={aside}>
        <EmptyState icon={<Hourglass />} title="No unpaid delivered orders" text="Cash from delivered orders shows here until the partner pays it in." />
      </Card>
    );
  }

  const top = Math.max(1, ...data.buckets.map((b) => b.amount));
  return (
    <Card title={title} aside={aside} className="agecard">
      <div className="bars" role="list" aria-label="Unpaid delivered orders by age">
        {data.buckets.map((b) => (
          <div className="bar-row" role="listitem" key={b.key}>
            <span>{b.label}<small style={{ color: 'var(--ink-3)', display: 'block' }}>{ordersText(b.orders)}</small></span>
            <div className="track"><i style={{ width: `${(b.amount / top) * 100}%`, background: BUCKET_COLOR[b.key] }} /></div>
            <span className="val num">{formatCurrency(b.amount)}</span>
          </div>
        ))}
      </div>
      <p className="note">
        <b className="num" style={{ color: 'var(--ink)' }}>{formatCurrency(data.total.amount)}</b> across {ordersText(data.total.orders)}, net of the delivery fee.{' '}
        {data.overdue.orders > 0 ? (
          <>
            <b data-testid="overdue-count">{ordersText(data.overdue.orders)}</b> past the partner's days to pay.{' '}
            <Link to="/orders?status=unpaid_by_agent">Show them in Orders</Link>
          </>
        ) : (
          'None is past the partner’s days to pay.'
        )}
      </p>
    </Card>
  );
}
