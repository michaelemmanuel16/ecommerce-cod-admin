/**
 * The names of the target metrics the app measures itself (M6-T09), and how each is measured. One place: the KPI layer, the
 * team report and the rewards read these, and the Targets editor writes them.
 */

/** Call rep (P7): orders the rep confirmed that got delivered, a count. */
export const CONFIRMED_DELIVERED_METRIC = 'confirmed_delivered';
/** Delivery: the delivery success rate, a percent. */
export const DELIVERY_SUCCESS_METRIC = 'delivery_success_rate';

export type MeasureBasis = 'count' | 'rate';

/** How a target of each known metric is measured. A metric not listed here has no data source for rewards. */
export const METRIC_BASIS: Readonly<Record<string, MeasureBasis>> = {
  [CONFIRMED_DELIVERED_METRIC]: 'count',
  [DELIVERY_SUCCESS_METRIC]: 'rate',
};
