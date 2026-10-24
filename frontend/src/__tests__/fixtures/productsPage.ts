import type { Holders, ProductDetail, ProductList, ProductRow, ProductsSummary } from '../../services/products.service';
import type { Shipment, ShipmentSummary } from '../../services/shipments.service';

const base = {
  description: null, imageUrl: null, isActive: true, lowStockDays: null, digitalFileUrl: null, digitalFileType: null,
  downloadLinkExpiryHours: null, maxDownloads: null, reservedTotal: 0, lowStockDaysEffective: 14,
};

export const COPYBOOK: ProductRow = {
  ...base, id: 1, sku: 'MG-CB-SET', name: 'Magic Groove copybook set', category: 'Education', price: 249, cogs: 30, marginPct: 88,
  productType: 'physical', onHandTotal: 158, daysOfCover: 7, deliveredInPeriod: 306, deliverySuccess: 48, status: 'low_stock',
};
export const PENS: ProductRow = {
  ...base, id: 2, sku: 'MG-PEN-REF', name: 'Magic Groove refill pens', category: 'Education', price: 40, cogs: 12, marginPct: 70,
  productType: 'physical', onHandTotal: 80, daysOfCover: null, deliveredInPeriod: 172, deliverySuccess: 71, status: 'active',
};
export const GUIDE: ProductRow = {
  ...base, id: 4, sku: 'SPH-GUIDE-DIG', name: "Smart Parent's Home Study Guide", category: 'Guides', price: 59, cogs: 3, marginPct: 95,
  productType: 'digital', onHandTotal: null, reservedTotal: null, daysOfCover: null, lowStockDaysEffective: null, deliveredInPeriod: 58,
  deliverySuccess: null, status: 'digital', digitalFileUrl: 'https://files.test/guide.pdf', digitalFileType: 'PDF', downloadLinkExpiryHours: 72, maxDownloads: 5,
};

export const PRODUCT_LIST: ProductList = {
  products: [COPYBOOK, PENS, GUIDE],
  counts: { active: 3, archived: 2, all: 5 },
  month: '2026-10',
  pagination: { page: 1, limit: 100, total: 3, pages: 1 },
  canSeeCost: true,
};

export const SUMMARY: ProductsSummary = {
  month: '2026-10',
  activeProducts: { active: 3, archived: 2 },
  bestSeller: { productId: 1, name: 'Magic Groove copybook set', sku: 'MG-CB-SET', units: 306 },
  averageMargin: 86,
  lowStock: 1,
  deliverySuccessTarget: 60,
};

export const HOLDERS: Holders = {
  product: { id: 1, name: 'Magic Groove copybook set', sku: 'MG-CB-SET', archived: false },
  holders: [
    {
      locationId: 10, name: 'Logiswift', type: 'partner_3pl', isActive: true, allocated: 300, inTransit: 0, delivered: 176, returned: 24, onHand: 100, reserved: 0, value: 3000,
      count: { countId: 5, lineId: 9, date: '2026-10-15', source: 'three_pl_dashboard', counted: 88, difference: -12, status: 'off' },
    },
    { locationId: 11, name: 'Kofi Appiah', type: 'agent', isActive: true, allocated: 80, inTransit: 20, delivered: 40, returned: 0, onHand: 40, reserved: 0, value: 1200, count: null },
  ],
  total: { allocated: 380, inTransit: 20, delivered: 216, returned: 24, onHand: 140, reserved: 0, value: 4200 },
  productTotal: 140,
  holdersWithNone: ['Esi Badu', 'Kwesi Amoah'],
};

export const DETAIL: ProductDetail = {
  id: 1, sku: 'MG-CB-SET', name: 'Magic Groove copybook set', description: null, category: 'Education', price: 249, cogs: 30, marginPct: 88, imageUrl: null,
  isActive: true, productType: 'physical', lowStockDays: null, digitalFileUrl: null, digitalFileType: null, downloadLinkExpiryHours: 72, maxDownloads: null,
  lockedFields: ['productType', 'cogs'], canSeeCost: true,
};

const ship = {
  supplier: 'Accra Print House', unitCost: 27, shippingCost: 450, customsDuties: '0.00', otherCosts: 150, totalCost: 8700, currency: 'GHS', storeCurrency: 'GHS',
  fxRate: null, fxRateSource: null, totalCostStore: 8700, expectedArrivalDate: '2026-10-22T00:00:00.000Z', receivedAt: null, quantityCounted: null,
  shortQuantity: null, destinationLocation: null, claimStatus: 'none' as const, claimAmount: 0, claimRecovered: null, claimNote: null, claimJournalEntryId: null,
  notes: null, product: { id: 1, name: 'Magic Groove copybook set', sku: 'MG-CB-SET' }, productId: 1,
};

export const PENDING: Shipment = { ...ship, id: 7, quantity: 300, landedCostPerUnit: 29, status: 'pending' };
export const FOREIGN: Shipment = {
  ...ship, id: 8, supplier: 'Guangzhou Stationery', quantity: 100, unitCost: 10, shippingCost: 0, otherCosts: 0, totalCost: 1000, currency: 'CNY', fxRate: 1.6, fxRateSource: 'auto',
  totalCostStore: 1600, landedCostPerUnit: 16, status: 'pending',
};
export const RECEIVED: Shipment = {
  ...ship, id: 9, quantity: 300, status: 'received', receivedAt: '2026-10-09T10:00:00.000Z', quantityCounted: 288, shortQuantity: 12, landedCostPerUnit: 30.21,
  destinationLocation: { id: 10, name: 'Logiswift', type: 'partner_3pl' }, claimStatus: 'open', claimAmount: 324,
};

export const SHIP_SUMMARY: ShipmentSummary = { pendingCount: 3, unitsOnTheWay: 1500, costToLand: 24950, currency: 'GHS' };
