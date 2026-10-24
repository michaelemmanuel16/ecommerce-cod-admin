import { describe, it, expect } from 'vitest';
import { parseView, writeView, DEFAULT_VIEW } from '../../pages/products/urlState';
import { countNote, coverText, marginPercent, monthShort, noneNote, pct, shortDay } from '../../pages/products/model';
import { defaultLocation } from '../../pages/products/useStockLocations';
import { todayYmd } from '../../utils/format';
import { effectiveRate, liveLanded, totalOf, type ShipmentFields } from '../../pages/products/shipModel';
import { COPYBOOK, HOLDERS, PENS, PENDING, RECEIVED } from '../fixtures/productsPage';

describe('Products view in the URL (M4-T21)', () => {
  it('reads the defaults from a plain URL and writes none back', () => {
    const view = parseView(new URLSearchParams(''));
    expect(view).toEqual(DEFAULT_VIEW);
    expect(writeView(view).toString()).toBe('');
  });

  it('round-trips the pane, tab, month, shipment filter and the open drawer', () => {
    const view = parseView(new URLSearchParams('pane=shipments&tab=archived&month=2026-09&ships=pending&edit=12'));
    expect(view).toEqual({ pane: 'shipments', tab: 'archived', month: '2026-09', ships: 'pending', edit: 12 });
    expect(parseView(writeView(view))).toEqual(view);
    expect(parseView(new URLSearchParams('edit=new')).edit).toBe('new');
  });

  it('ignores values it does not know', () => {
    expect(parseView(new URLSearchParams('tab=x&month=2026-13&ships=y&edit=-3&pane=z'))).toEqual(DEFAULT_VIEW);
  });
});

describe('Products wording (M4-T21)', () => {
  it('days of cover, plenty and sold out', () => {
    expect(coverText(COPYBOOK)).toBe('7 days of cover');
    expect(coverText(PENS)).toBe('Plenty');
    expect(coverText({ ...PENS, onHandTotal: 0 })).toBe('Sold out');
    expect(coverText({ ...PENS, productType: 'digital' })).toBeNull();
  });

  it('notes a count that differs from our records, and the holders with none', () => {
    expect(countNote(HOLDERS.holders[0])).toBe('Our records say 100 on hand at Logiswift. The 3PL dashboard count of 15 Oct says 88.');
    expect(countNote(HOLDERS.holders[1])).toBeNull();
    expect(noneNote(HOLDERS.holdersWithNone)).toBe('Esi Badu and Kwesi Amoah hold none of this product right now.');
    expect(noneNote(['Kasapa Express'])).toBe('Kasapa Express holds none of this product right now.');
    expect(noneNote([])).toBeNull();
  });

  it('a count made old by later movement gives no note', () => {
    const holder = { ...HOLDERS.holders[0], count: { ...HOLDERS.holders[0].count!, status: 'old' as const, difference: null } };
    expect(countNote(holder)).toBeNull();
  });

  it('percent text', () => {
    expect(pct(88.4)).toBe('88%');
    expect(pct(null)).toBe('—');
  });
});

describe('Shipment live landed cost (M4-T23)', () => {
  const fields: ShipmentFields = {
    productId: '1', supplier: '', quantity: '300', currency: 'GHS', fxRate: '', unitCost: '27', shippingCost: '450', customsDuties: '0', otherCosts: '150', expectedArrivalDate: '', notes: '',
  };
  it('total over the units shipped; the rate converts it', () => {
    expect(totalOf(fields)).toBe(8700);
    expect(liveLanded(8700, null, 300)).toBe(29);
    expect(liveLanded(8700, null, 288)).toBe(30.2083);
    expect(liveLanded(1000, 1.6, 100)).toBe(16);
    expect(liveLanded(8700, null, 0)).toBeNull();
  });
});

describe('formulas that mirror the server (M4-T22, M4-T23)', () => {
  it('margin: a physical product with no cost has none; a digital one at cost 0 is 100%; price 0 has none', () => {
    expect(marginPercent(249, 30, 'physical')).toBe(88);
    expect(marginPercent(40, 0, 'physical')).toBeNull();
    expect(marginPercent(59, 0, 'digital')).toBe(100);
    expect(marginPercent(0, 5, 'physical')).toBeNull();
    expect(marginPercent(10, 30, 'physical')).toBe(-200);
  });

  it('the rate on screen: 1 in the store currency, a typed rate first, else the stored one, else none', () => {
    expect(effectiveRate({ foreign: false, typed: 2, stored: 3 })).toBe(1);
    expect(effectiveRate({ foreign: true, typed: 2, stored: 3 })).toBe(2);
    expect(effectiveRate({ foreign: true, typed: null, stored: 3 })).toBe(3);
    expect(effectiveRate({ foreign: true, typed: null, stored: null })).toBeNull();
  });

  it('landed cost rounds in the two steps of the server: the total at the rate to 4 places, then per unit to 4 places', () => {
    expect(liveLanded(10, 0.33333, 3)).toBe(1.1111); // 3.3333 / 3 = 1.1111
    expect(liveLanded(1, 1.00005, 1)).toBe(1.0001); // half up, not 1.0000
  });

  it('the default holder is where stock was last received, if it is still a holder; none otherwise', () => {
    const older = { ...RECEIVED, id: 1, receivedAt: '2026-10-01T10:00:00.000Z', destinationLocation: { id: 5, name: 'Own store', type: 'own_store' } };
    const locations = [{ id: 5, name: 'Own store', type: 'own_store' as const }, { id: 10, name: 'Logiswift', type: 'partner_3pl' as const }];
    expect(defaultLocation(locations, [older, RECEIVED])).toBe(10);
    expect(defaultLocation(locations, [])).toBeNull();
    expect(defaultLocation(locations, [PENDING])).toBeNull();
    expect(defaultLocation([locations[0]], [RECEIVED])).toBeNull();
  });

  it('days and months: one formatter, local today', () => {
    expect(shortDay('2026-10-15')).toBe('15 Oct');
    expect(shortDay('2026-10-22T00:00:00.000Z')).toBe('22 Oct');
    expect(shortDay(null)).toBe('—');
    expect(monthShort('2026-10')).toBe('Oct');
    // 23:30 on 24 October in the viewer's zone is still the 24th (toISOString would roll over in zones ahead of UTC)
    expect(todayYmd(new Date(2026, 9, 24, 23, 30))).toBe('2026-10-24');
  });
});
