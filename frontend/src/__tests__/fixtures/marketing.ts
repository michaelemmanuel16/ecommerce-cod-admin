import type { CampaignRow, CampaignTotals, Funnel, MaxCpa, MoneyView, ProductRow, Summary, TileSet } from '../../services/marketing.service';

/** An NGN ad account at 112 per GH₵1: the account figure first, the store figure under it. */
export const mv = (ngn: number, rate = 112): MoneyView => ({
  store: (ngn / rate).toFixed(2), account: ngn.toFixed(2), accountCurrency: 'NGN', rate, rateDate: '2026-11-01',
});

const maxCpa = (over: Partial<MaxCpa> = {}): MaxCpa => ({
  available: true, yieldPct: 34, profitBeforeAds: mv(20720), maxCpa: mv(7040), message: null, closedOrders: 120, ...over,
});

const tiles = (over: Partial<TileSet> = {}): TileSet => ({
  from: '2026-11-01', to: '2026-11-11', spend: mv(8_530_000), spendDaysWaitingForRate: 0, ordersPlaced: 400, confirmed: 300, delivered: 100,
  projectedCostPerDelivered: { value: mv(17360), message: null },
  actualCostPerDelivered: { label: 'Actual, delivered in range', value: mv(22686) },
  maxCpa: maxCpa(), ...over,
});

export const summary = (over: Partial<Summary> = {}): Summary => ({
  ...tiles(),
  previous: tiles({
    from: '2026-10-01', to: '2026-10-11', spend: mv(7_000_000),
    projectedCostPerDelivered: { value: mv(20000), message: null },
    actualCostPerDelivered: { label: 'Actual, delivered in range', value: mv(25000) },
    maxCpa: maxCpa({ yieldPct: 30, maxCpa: mv(6000) }),
  }),
  ...over,
});

export const funnel = (): Funnel => ({
  from: '2026-11-01', to: '2026-11-11', productId: null,
  impressions: 100000, linkClicks: 2000, landingPageViews: 1500, checkoutsStarted: 600, ordersPlaced: 400, confirmed: 300, delivered: 100,
});

export const productRow = (over: Partial<ProductRow> = {}): ProductRow => ({
  product: { id: 7, name: 'Magic Groove', archived: false }, spend: mv(500000), purchases: 90, ordersPlaced: 100, confirmed: 70, delivered: 30,
  yieldPct: 34, maxCpa: maxCpa(), costPerPlaced: mv(5000), lowData: false, ...over,
});

export const campaignRow = (name: string, status: CampaignRow['status'], over: Partial<CampaignRow> = {}): CampaignRow => ({
  adAccountId: 1, campaignId: `id-${name}`, campaignName: name,
  product: status === 'Not mapped' ? null : { id: 7, name: 'Magic Groove', archived: false, via: 'campaign' as const },
  spend: mv(100000), impressions: 1000, linkClicks: 100, landingPageViews: 80, checkoutsStarted: 20, purchases: 20, cpa: mv(5000),
  projectedDelivered: 6.7, projectedDeliveredLabel: 'Meta purchases', maxCpa: status === 'Not mapped' ? null : maxCpa(), status, lowData: false, ...over,
});

export const totals = (): CampaignTotals => ({
  spend: mv(900000), impressions: 9000, linkClicks: 900, landingPageViews: 700, checkoutsStarted: 180, purchases: 60, cpa: mv(15000), projectedDelivered: 20.1,
});
