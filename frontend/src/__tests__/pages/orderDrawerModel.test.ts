import { describe, it, expect } from 'vitest';
import { buildEdit, draftOf, editGroup, linesTotal, telUrl, whatsappUrl } from '../../pages/orders/drawer/model';
import { DETAIL } from '../fixtures/orderDetail';

describe('order drawer model (M3-T46, T47)', () => {
  it('the WhatsApp link is wa.me with the E.164 number and no plus; the call link is tel:', () => {
    expect(whatsappUrl('+233245550182')).toBe('https://wa.me/233245550182');
    expect(telUrl('+233245550182')).toBe('tel:+233245550182');
  });

  it('editable fields follow the status group (F-318)', () => {
    expect(['pending_confirmation', 'payment_pending', 'confirmed', 'preparing', 'ready_for_pickup'].map((s) => editGroup(s as never))).toEqual(Array(5).fill('full'));
    expect(['out_for_delivery', 'failed_delivery'].map((s) => editGroup(s as never))).toEqual(['dispatched', 'dispatched']);
    expect(['delivered', 'digital_delivered', 'returned', 'cancelled'].map((s) => editGroup(s as never))).toEqual(Array(4).fill('notes'));
  });

  it('an untouched form changes nothing', () => {
    const r = buildEdit(DETAIL, draftOf(DETAIL));
    expect(r.changed).toEqual([]);
    expect(r.total).toBeNull();
  });

  it('sends only the fields that changed, and the lines total follows the lines', () => {
    const d = draftOf(DETAIL);
    d.address = '9 New Road';
    d.items = [{ ...d.items[0], quantity: '2' }];
    expect(linesTotal(d)).toBe(498);
    const r = buildEdit(DETAIL, d);
    expect(r.changed.sort()).toEqual(['deliveryAddress', 'orderItems']);
    expect(r.body.orderItems).toEqual([{ productId: 1, quantity: 2, unitPrice: 249 }]);
    expect(r.body).not.toHaveProperty('totalAmount'); // the server works the total out from the lines
    expect(r.total).toEqual({ was: 249, now: 498 });
  });

  it('a typed total is sent', () => {
    const d = draftOf(DETAIL);
    d.total = '200';
    d.totalTouched = true;
    expect(buildEdit(DETAIL, d).body).toEqual({ totalAmount: 200 });
  });

  it('after dispatch only phone, alternate phone, address, region, town and notes go out; delivered orders send notes only', () => {
    const d = draftOf({ ...DETAIL, status: 'out_for_delivery' });
    d.name = 'Someone Else';
    d.address = 'Gate is blue';
    d.items = [{ ...d.items[0], quantity: '9' }];
    expect(Object.keys(buildEdit({ ...DETAIL, status: 'out_for_delivery' }, d).body)).toEqual(['deliveryAddress']);

    const done = draftOf({ ...DETAIL, status: 'delivered' });
    done.address = 'Elsewhere';
    done.notes = 'Late note';
    expect(buildEdit({ ...DETAIL, status: 'delivered' }, done).body).toEqual({ notes: 'Late note' });
  });
});
