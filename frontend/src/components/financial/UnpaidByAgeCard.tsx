import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { Button, Card, EmptyState } from '../ui-v2';
import type { UnpaidByAge } from '../../services/collections.service';
import { formatCurrency } from '../../utils/format';
import { ListSkeleton } from '../../pages/deliveries/ListSkeleton';
import { BarList } from './BarList';
import { bucketColor, ordersText } from '../../pages/financial/collections/model';

interface Props {
  /** null while it loads. Build it from the aging report (`unpaidByAgeOf`) or `collectionsService.unpaidByAge()`. */
  data: UnpaidByAge | null;
  failed?: boolean;
  onRetry?: () => void;
}

/**
 * "Unpaid delivered orders, by age" (F-910, M5-T35): four buckets, net of the delivery fee. The overdue count is the same
 * number as the Orders "Unpaid by agent" tab (both come from agingService.overdueFilter).
 */
export function UnpaidByAgeCard({ data, failed, onRetry }: Props) {
  const title = 'Unpaid delivered orders';
  const aside = 'By age';

  if (!data && failed) {
    return (
      <Card title={title} aside={aside}>
        <EmptyState title="The unpaid orders could not load." action={onRetry && <Button onClick={onRetry}>Try again</Button>} />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card title={title} aside={aside}>
        <ListSkeleton label="Loading unpaid orders" rows={4} height={14} />
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
      <BarList
        label="Unpaid delivered orders by age"
        rows={data.buckets.map((b) => ({ key: b.key, label: b.label, sub: ordersText(b.orders), value: formatCurrency(b.amount), width: (b.amount / top) * 100, color: bucketColor(b.key) }))}
      />
      <p className="note">
        <b className="num ink">{formatCurrency(data.total.amount)}</b> across {ordersText(data.total.orders)}, net of the delivery fee.{' '}
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
