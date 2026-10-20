/** Builders for the results of the KPI layer functions, for unit tests that mock services/kpi. */
const meta = { dateBasis: 'deliveryDate', formulaId: 'test', from: '', to: '', asOf: '' };

export const revenueResult = (total: string, deliveredOrders = 0): any => ({
  physical: { name: 'Delivered revenue, physical', value: total, unit: 'money', ...meta },
  digital: { name: 'Delivered revenue, digital', value: '0.00', unit: 'money', ...meta },
  total: { name: 'Delivered revenue', value: total, unit: 'money', ...meta },
  deliveredOrders: { name: 'Delivered orders', value: deliveredOrders, unit: 'count', ...meta },
});

const rate = (name: string, value: number | null, detail?: Record<string, number>): any => ({
  name, value, unit: 'percent', ...meta, ...(detail ? { detail } : {}),
});

export const ratesResult = (confirmation: number | null, success: number | null, yieldValue: number | null): any => ({
  confirmationRate: rate('Confirmation rate', confirmation),
  deliverySuccessRate: rate('Delivery success rate', success),
  orderToCashYield: rate('Order-to-cash yield', yieldValue),
});

export interface RepRateInput {
  placed: number;
  confirmed: number;
  confirmationRate: number | null;
  deliveredFromConfirmedRate: number | null;
}

/** repRates() result: `reps` by rep id, an empty rep gets null rates and zero counts. */
export const repRatesResult = (reps: Record<number, RepRateInput>): any => {
  const build = (r?: RepRateInput) => ({
    confirmationRate: rate('Confirmation rate', r?.confirmationRate ?? null, { confirmed: r?.confirmed ?? 0, placed: r?.placed ?? 0 }),
    deliveredFromConfirmedRate: rate('Delivered from confirmed rate', r?.deliveredFromConfirmedRate ?? null, { delivered: 0, failed: 0, returned: 0, closed: 0 }),
  });
  return { rep: (id: number) => build(reps[id]), all: build() };
};

export const partnerRow = (partnerId: number, assigned: number, delivered: number, failed: number, returned: number, successRate: number | null): any => ({
  partnerId,
  name: `Partner ${partnerId}`,
  assigned,
  deliverySuccessRate: rate('Delivery success rate', successRate, { delivered, failed, returned, closed: delivered + failed + returned }),
});

/** deliveredRevenueByRep() result: revenue and delivered orders by rep id. */
export const repRevenueResult = (reps: Record<number, { revenue: string; deliveredOrders: number }>): Map<number, { revenue: string; deliveredOrders: number }> =>
  new Map(Object.entries(reps).map(([id, v]) => [Number(id), v]));
