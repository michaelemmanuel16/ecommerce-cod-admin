/**
 * Widget Registry
 * Maps widget type strings to React components
 */

import { WidgetType } from '../../config/types/dashboard';

// Import widget components
import { StatCardWidget } from './widgets/StatCardWidget';
import { LineChartWidget } from './widgets/LineChartWidget';
import { DonutChartWidget } from './widgets/DonutChartWidget';
import { LeaderboardWidget } from './widgets/LeaderboardWidget';
import { BarChartWidget } from './widgets/BarChartWidget';
import { DataTableWidget } from './widgets/DataTableWidget';
import { OrdersAwaitingWidget } from './widgets/OrdersAwaitingWidget';
import { RecentActivityWidget } from './widgets/RecentActivityWidget';

type WidgetComponent = React.FC<any>;

/**
 * Registry mapping widget types to components
 * Add new widget types here when creating custom widgets
 */
export const widgetRegistry: Record<WidgetType, WidgetComponent> = {
  stat: StatCardWidget,
  lineChart: LineChartWidget,
  donutChart: DonutChartWidget,
  barChart: BarChartWidget,
  leaderboard: LeaderboardWidget,
  dataTable: DataTableWidget,
  ordersAwaiting: OrdersAwaitingWidget,
  recentActivity: RecentActivityWidget,
};

/**
 * Register a custom widget type
 * @param type - Widget type identifier
 * @param component - React component
 */
export function registerWidget(type: string, component: WidgetComponent): void {
  (widgetRegistry as any)[type] = component;
}

/**
 * Check if a widget type is registered
 * @param type - Widget type to check
 * @returns True if registered
 */
export function isWidgetRegistered(type: string): boolean {
  return type in widgetRegistry;
}
