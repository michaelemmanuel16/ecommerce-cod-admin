import React from 'react';
import { Badge } from '../ui/Badge';
import { formatCurrency, formatDate } from '../../utils/format';

export interface BillingEvent {
  id: number;
  type: string;
  reference: string;
  timestamp: string;
  tenant: { id: string; name: string } | null;
  amountNGN: number | string | null;
}

const eventLabel: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'default' }> = {
  'subscription.create': { label: 'Subscribed', variant: 'success' },
  'charge.success': { label: 'Charge', variant: 'success' },
  'invoice.payment_failed': { label: 'Payment failed', variant: 'danger' },
  'subscription.disable': { label: 'Cancelled', variant: 'warning' },
};

interface BillingActivityTableProps {
  events: BillingEvent[];
  loading?: boolean;
  error?: string | null;
  /** Hide the Tenant column when the table is already scoped to one tenant. */
  showTenant?: boolean;
  emptyText?: string;
}

/**
 * Shared read-only billing-events table (MAN-61, F3). Used both for the global
 * platform billing-activity list and for a single tenant's billing history on
 * its detail page. Pass `showTenant={false}` when the rows are already one tenant.
 */
export const BillingActivityTable: React.FC<BillingActivityTableProps> = ({
  events,
  loading = false,
  error = null,
  showTenant = true,
  emptyText = 'No billing activity yet.',
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
      </div>
    );
  }
  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (events.length === 0) return <p className="text-gray-500 text-sm">{emptyText}</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-gray-500">
            <th className="py-2 pr-4 font-medium">Event</th>
            {showTenant && <th className="py-2 pr-4 font-medium">Tenant</th>}
            <th className="py-2 pr-4 font-medium">Amount</th>
            <th className="py-2 pr-4 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const meta = eventLabel[e.type] ?? { label: e.type, variant: 'default' as const };
            return (
              <tr key={e.id} className="border-b border-gray-100">
                <td className="py-2 pr-4">
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                </td>
                {showTenant && <td className="py-2 pr-4 text-gray-900">{e.tenant?.name ?? '—'}</td>}
                <td className="py-2 pr-4 text-gray-700">
                  {e.amountNGN != null ? formatCurrency(Number(e.amountNGN), 'NGN') : '—'}
                </td>
                <td className="py-2 pr-4 text-gray-500">{formatDate(e.timestamp, 'MMM dd, yyyy HH:mm')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
