import { describe, it, expect } from 'vitest';
import { roleAppRoute } from '../../config/features';
import { dashboardConfigs, getDashboardConfig, hasDashboardConfig } from '../../config/dashboards';
import { visibleGroups } from '../../components/shell/navModel';
import { formatOrderNumber, parseOrderNumber } from '../../utils/orderNumber';
import { ORDER_STATUS_LABELS, getOrderStatusLabel } from '../../utils/orderStatus';

describe('M7-T13 rep home and clean-up', () => {
  describe('rep app routing', () => {
    it('sales_rep routes to the rep app', () => {
      expect(roleAppRoute('sales_rep')).toBe('/rep');
    });

    it('Earnings history nav item is hidden from sales_rep without the menu key', () => {
      const groups = visibleGroups(['orders', 'customers'], 'sales_rep');
      const allItems = groups.flatMap((g) => g.items);
      expect(allItems.some((i) => i.key === 'earningsHistory')).toBe(false);
    });

    it('keeps the old rep dashboard config', () => {
      expect(hasDashboardConfig('sales_rep')).toBe(true);
      expect(getDashboardConfig('sales_rep')).toBeDefined();
    });
  });

  describe('canonical order id formatter and status labels', () => {
    it('formats order numbers consistently as #<id>', () => {
      expect(formatOrderNumber(24041)).toBe('#24041');
      expect(formatOrderNumber('999')).toBe('#999');
      expect(parseOrderNumber('#24041')).toBe(24041);
      expect(parseOrderNumber('24041')).toBe(24041);
      expect(parseOrderNumber('invalid')).toBeNull();
    });

    it('provides canonical labels for all order statuses', () => {
      expect(ORDER_STATUS_LABELS.pending_confirmation).toBe('Pending confirmation');
      expect(ORDER_STATUS_LABELS.confirmed).toBe('Confirmed');
      expect(ORDER_STATUS_LABELS.out_for_delivery).toBe('Out for delivery');
      expect(ORDER_STATUS_LABELS.delivered).toBe('Delivered');
      expect(ORDER_STATUS_LABELS.failed_delivery).toBe('Failed delivery');
      expect(ORDER_STATUS_LABELS.cancelled).toBe('Cancelled');
      expect(ORDER_STATUS_LABELS.returned).toBe('Returned');
      expect(getOrderStatusLabel('delivered')).toBe('Delivered');
    });
  });
});
