/**
 * M4-T16 (F-600): the pure rules of the Products API: margin, days of cover, status tag, cost visibility.
 */
import { describe, it, expect } from '@jest/globals';
import { daysOfCover, marginPercent, productStatus, withoutCost, DEFAULT_LOW_STOCK_DAYS } from '../../services/productService';
import { canSeeCost } from '../../utils/costAccess';

describe('marginPercent', () => {
  it('is (price - cost) / price in whole percent: copybook 88, pens 70, grip trainer 69, guide 95', () => {
    expect(marginPercent(249, 30)).toBe(88);
    expect(marginPercent(40, 12)).toBe(70);
    expect(marginPercent(35, '10.85')).toBe(69);
    expect(marginPercent(59, '2.95')).toBe(95);
  });
  it('is null when the price is 0', () => {
    expect(marginPercent(0, 5)).toBeNull();
  });
  it('a physical product with cost 0 or none has no margin; a digital product at cost 0 is 100', () => {
    expect(marginPercent(50, null)).toBeNull();
    expect(marginPercent(50, 0)).toBeNull();
    expect(marginPercent(50, 0, 'digital')).toBe(100);
    expect(marginPercent(50, null, 'digital')).toBe(100);
  });
  it('can be negative (cost above price)', () => {
    expect(marginPercent(10, 15)).toBe(-50);
  });
});

describe('daysOfCover', () => {
  it('is on hand divided by the average per day over 14 days', () => {
    expect(daysOfCover(200, 28)).toBe(100); // 2 a day
    expect(daysOfCover(21, 14)).toBe(21);
    expect(daysOfCover(10, 3)).toBe(46.7);
  });
  it('is null ("No sales") when nothing was delivered', () => {
    expect(daysOfCover(200, 0)).toBeNull();
  });
});

describe('productStatus', () => {
  const physical = { isActive: true, productType: 'physical' };
  it('archived wins, then digital, then out of stock, then low stock', () => {
    expect(productStatus({ ...physical, isActive: false }, 0, null, 14)).toBe('archived');
    expect(productStatus({ isActive: true, productType: 'digital' }, 0, null, 14)).toBe('digital');
    expect(productStatus(physical, 0, 3, 14)).toBe('out_of_stock');
    expect(productStatus(physical, -4, null, 14)).toBe('out_of_stock');
    expect(productStatus(physical, 20, 13.9, 14)).toBe('low_stock');
    expect(productStatus(physical, 20, 14, 14)).toBe('active');
  });
  it('does not flag low stock when there are no sales', () => {
    expect(productStatus(physical, 20, null, 14)).toBe('active');
  });
  it('the default limit is 14 days', () => {
    expect(DEFAULT_LOW_STOCK_DAYS).toBe(14);
  });
});

describe('cost visibility', () => {
  it('owner, admin, manager, finance clerk and stock keeper see cost; call rep and delivery agent do not', () => {
    for (const role of ['super_admin', 'admin', 'manager', 'accountant', 'inventory_manager']) expect(canSeeCost(role)).toBe(true);
    for (const role of ['sales_rep', 'delivery_agent', undefined, 'unknown']) expect(canSeeCost(role)).toBe(false);
  });
  it('withoutCost drops cogs and marginPct and keeps the rest', () => {
    expect(withoutCost({ id: 1, price: 5, cogs: 2, marginPct: 60 })).toEqual({ id: 1, price: 5 });
  });
});
