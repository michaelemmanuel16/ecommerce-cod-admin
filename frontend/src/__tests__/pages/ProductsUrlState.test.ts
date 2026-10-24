import { describe, it, expect } from 'vitest';
import { parseView, writeView, DEFAULT_VIEW } from '../../pages/products/urlState';
import { countNote, coverText, noneNote, pct } from '../../pages/products/model';
import { liveLanded, totalOf, type ShipmentFields } from '../../pages/products/shipModel';
import { COPYBOOK, HOLDERS, PENS } from '../fixtures/productsPage';

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
