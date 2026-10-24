import type { LocationCard, Overview, PhysicalProduct, StockRow, Transfer } from '../../services/inventory.service';

/** The stock numbers of docs/mockups/v2/NUMBERS.md as the overview API sends them (the Logiswift copybook set is 12 units under our records). */
export const PRODUCTS: PhysicalProduct[] = [
  { id: 1, name: 'Magic Groove copybook set', sku: 'MG-CB-SET' },
  { id: 2, name: 'Magic Groove refill pens', sku: 'MG-PEN-REF' },
  { id: 3, name: 'Pencil grip trainer', sku: 'MG-GRIP-01' },
];

const card = (c: Partial<LocationCard> & Pick<LocationCard, 'id' | 'name' | 'type'>): LocationCard => ({
  address: null, userId: null, onHand: 0, reserved: 0, products: 0, inTransit: 0, latestCount: null, ...c,
});

export const LOGISWIFT = 10;
export const KOFI = 11;
export const ESI = 12;
export const STORE = 13;

export const CARDS: LocationCard[] = [
  card({ id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl', address: 'Tema', onHand: 342, reserved: 59, products: 3, latestCount: { countId: 5, date: '2026-10-15', source: 'three_pl_dashboard', unitsOff: 12, isOld: false } }),
  card({ id: KOFI, name: 'Kofi Appiah', type: 'agent', userId: 4, onHand: 99, reserved: 18, products: 3, inTransit: 20, latestCount: { countId: 6, date: '2026-10-15', source: 'agent_count', unitsOff: 0, isOld: false } }),
  card({ id: ESI, name: 'Esi Badu', type: 'agent', userId: 5, onHand: 12, reserved: 3, products: 1, latestCount: { countId: 7, date: '2026-10-10', source: 'agent_count', unitsOff: 0, isOld: true } }),
];

const row = (r: Partial<StockRow> & Pick<StockRow, 'locationId' | 'locationName' | 'locationType' | 'productId' | 'productName' | 'sku' | 'onHand'>): StockRow => ({
  locationActive: true, archived: false, reserved: 0, inTransit: 0, count: null, ...r,
});

export const ROWS: StockRow[] = [
  row({ locationId: LOGISWIFT, locationName: 'Logiswift', locationType: 'partner_3pl', productId: 1, productName: 'Magic Groove copybook set', sku: 'MG-CB-SET', onHand: 200, reserved: 34, count: { countId: 5, lineId: 50, date: '2026-10-15', source: 'three_pl_dashboard', counted: 188, difference: -12, status: 'off' } }),
  row({ locationId: KOFI, locationName: 'Kofi Appiah', locationType: 'agent', productId: 1, productName: 'Magic Groove copybook set', sku: 'MG-CB-SET', onHand: 36, reserved: 11, inTransit: 20, count: { countId: 6, lineId: 60, date: '2026-10-15', source: 'agent_count', counted: 36, difference: 0, status: 'matches' } }),
  row({ locationId: LOGISWIFT, locationName: 'Logiswift', locationType: 'partner_3pl', productId: 2, productName: 'Magic Groove refill pens', sku: 'MG-PEN-REF', onHand: 62, reserved: 11 }),
  row({ locationId: KOFI, locationName: 'Kofi Appiah', locationType: 'agent', productId: 2, productName: 'Magic Groove refill pens', sku: 'MG-PEN-REF', onHand: 18, reserved: 4 }),
  row({ locationId: ESI, locationName: 'Esi Badu', locationType: 'agent', productId: 3, productName: 'Pencil grip trainer', sku: 'MG-GRIP-01', onHand: 12, reserved: 3, count: { countId: 7, lineId: 70, date: '2026-10-10', source: 'agent_count', counted: 12, difference: null, status: 'old' } }),
];

export const OVERVIEW: Overview = { hasOwnStore: false, locations: CARDS, stockByLocation: ROWS };

export const transfer = (t: Partial<Transfer> & Pick<Transfer, 'id'>): Transfer => ({
  productId: 1, quantity: 10, transferType: 'allocation', status: 'in_transit', receivedQuantity: null, receivedAt: null, reason: null,
  notes: null, orderId: null, shipmentId: null, createdAt: '2026-10-17T11:20:00.000Z', reversedAt: null,
  product: { id: 1, name: 'Magic Groove copybook set', sku: 'MG-CB-SET' },
  fromLocation: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' },
  toLocation: { id: KOFI, name: 'Kofi Appiah', type: 'agent' },
  createdBy: { id: 1, firstName: 'Manny', lastName: 'Owner' },
  shortQuantity: 0, overdue: false, ...t,
});

export const TRANSFERS: Transfer[] = [
  transfer({ id: 1, quantity: 20 }),
  transfer({ id: 2, quantity: 10, status: 'disputed', receivedQuantity: 8, shortQuantity: 2, reason: 'short_in_package', toLocation: { id: ESI, name: 'Esi Badu', type: 'agent' } }),
  transfer({ id: 3, quantity: 30, status: 'received', receivedQuantity: 30, productId: 2, product: { id: 2, name: 'Magic Groove refill pens', sku: 'MG-PEN-REF' } }),
  transfer({ id: 4, quantity: 50, status: 'in_transit', overdue: true, fromLocation: { id: KOFI, name: 'Kofi Appiah', type: 'agent' }, toLocation: { id: LOGISWIFT, name: 'Logiswift', type: 'partner_3pl' }, transferType: 'return_to_warehouse' }),
];
