import type { Shipment } from '../../services/shipments.service';
import { num } from './model';

/** The landed cost per unit of a shipment as the modals show it live: total in store currency over the units. */
export function liveLanded(total: number, rate: number | null, units: number): number | null {
  if (!(units > 0)) return null;
  return Math.round((total * (rate ?? 1) / units) * 10000) / 10000;
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
  customsDuties: String(num(s.customsDuties)),
  otherCosts: String(s.otherCosts),
  expectedArrivalDate: s.expectedArrivalDate ? s.expectedArrivalDate.slice(0, 10) : '',
  notes: s.notes ?? '',
});

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
/** "22 Oct" from an ISO timestamp or date; "—" when empty. Dates are UTC days. */
export const dayText = (iso: string | null): string => (iso ? DAY.format(new Date(`${iso.slice(0, 10)}T12:00:00`)) : '—');

export const today = (): string => new Date().toISOString().slice(0, 10);
