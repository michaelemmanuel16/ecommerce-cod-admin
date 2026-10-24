import type { Shipment } from '../../services/shipments.service';
import { parseMoney } from '../../utils/money';

/** A shipment that is no longer pending: received (or an old arrived row). It is locked. */
export const isReceived = (s: Shipment): boolean => s.status !== 'pending';

/** Round half up to 4 places, as the server's Money.roundHalfUp(…, 4) does (the toPrecision step drops binary noise such as 1.00005 = 1.0000499…). */
const round4 = (n: number): number => Math.round(Number((n * 1e4).toPrecision(15))) / 1e4;

/**
 * The rate that turns a shipment's currency into the store currency, as the screen shows it: 1 in the store currency, a typed
 * rate, else the stored one. Null when a foreign shipment has neither yet (the server looks it up when you save).
 */
export function effectiveRate({ foreign, typed, stored }: { foreign: boolean; typed: number | null; stored: number | null }): number | null {
  return !foreign ? 1 : typed ?? stored;
}

/**
 * Landed cost per unit (D2), the server's two steps: total in store currency at the rate, rounded to 4 places, over the units,
 * rounded to 4 places. Null with no units.
 */
export function liveLanded(total: number, rate: number | null, units: number): number | null {
  if (!(units > 0)) return null;
  return round4(round4(total * (rate ?? 1)) / units);
}

export interface ShipmentFields {
  productId: string;
  supplier: string;
  quantity: string;
  currency: string;
  fxRate: string;
  unitCost: string;
  shippingCost: string;
  customsDuties: string;
  otherCosts: string;
  expectedArrivalDate: string;
  notes: string;
}

export const totalOf = (f: ShipmentFields): number =>
  Number(f.quantity || 0) * Number(f.unitCost || 0) + Number(f.shippingCost || 0) + Number(f.customsDuties || 0) + Number(f.otherCosts || 0);

export const fromShipment = (s: Shipment): ShipmentFields => ({
  productId: String(s.productId),
  supplier: s.supplier ?? '',
  quantity: String(s.quantity),
  currency: s.currency,
  fxRate: s.fxRateSource === 'manual' && s.fxRate ? String(s.fxRate) : '',
  unitCost: String(s.unitCost),
  shippingCost: String(s.shippingCost),
  customsDuties: String(parseMoney(s.customsDuties)),
  otherCosts: String(s.otherCosts),
  expectedArrivalDate: s.expectedArrivalDate ? s.expectedArrivalDate.slice(0, 10) : '',
  notes: s.notes ?? '',
});
