import type { ColumnId } from './useColumnPrefs';

export const COLUMN_LABELS: Record<ColumnId, string> = {
  select: 'Select', order: 'Order', customer: 'Customer', altPhone: 'Alternate phone', product: 'Product', status: 'Status',
  rep: 'Call rep', agent: 'Delivery agent', amount: 'Amount', date: 'Date', assign: 'Assign',
};
