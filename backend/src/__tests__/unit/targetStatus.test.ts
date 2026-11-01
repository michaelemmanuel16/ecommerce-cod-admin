/** M6-T15: the status words of the Targets page. */
import { describe, it, expect } from '@jest/globals';
import { STATUS_LABEL, targetStatus } from '../../services/targetStatus';
import { monthStatus } from '../../services/targetActuals';

const base = { pace: 50, margin: 40, marginTarget: 35, over: false };

describe('targetStatus', () => {
  it('no target gives no status', () => {
    expect(targetStatus({ ...base, percent: null })).toBeNull();
  });
  it('revenue at or above the target is "Revenue hit"; with the margin under its target it is "Revenue hit, margin missed"', () => {
    expect(targetStatus({ ...base, percent: 100 })).toBe('revenue_hit');
    expect(targetStatus({ ...base, percent: 103, over: true })).toBe('revenue_hit');
    expect(targetStatus({ ...base, percent: 103, margin: 12 })).toBe('hit_margin_missed');
    expect(STATUS_LABEL.hit_margin_missed).toBe('Revenue hit, margin missed');
  });
  it('no margin data never counts as a missed margin', () => {
    expect(targetStatus({ ...base, percent: 110, margin: null })).toBe('revenue_hit');
  });
  it('under the target: ahead by 3 points or more, on track at the pace, behind under it', () => {
    expect(targetStatus({ ...base, percent: 53 })).toBe('ahead');
    expect(targetStatus({ ...base, percent: 52.9 })).toBe('on_track');
    expect(targetStatus({ ...base, percent: 50 })).toBe('on_track');
    expect(targetStatus({ ...base, percent: 49.9 })).toBe('behind');
  });
  it('a period that is over and missed is behind, whatever the pace', () => {
    expect(targetStatus({ ...base, percent: 99, pace: 100, over: true })).toBe('behind');
    expect(targetStatus({ ...base, percent: 99, pace: 0, over: true })).toBe('behind');
  });
  it('year 17 Oct fixture: 76.8% done against the quarter-plan pace of 75.5 is on track (1 point ahead)', () => {
    expect(targetStatus({ ...base, percent: 76.8, pace: 75.5 })).toBe('on_track');
  });
});

describe('monthStatus (an attainment row: same words, no margin)', () => {
  const today = '2026-10-17'; // 17 of 31 days gone: pace 54.8
  it('this month: ahead by 3 points or more, on track at the pace, behind under it', () => {
    expect(monthStatus(60, '2026-10', today)?.key).toBe('ahead');
    expect(monthStatus(55, '2026-10', today)?.key).toBe('on_track');
    expect(monthStatus(44, '2026-10', today)).toEqual({ key: 'behind', label: 'Behind' });
  });
  it('100% or more is hit; a past month under 100 is behind; a future month and no percent have none', () => {
    expect(monthStatus(100, '2026-10', today)?.key).toBe('revenue_hit');
    expect(monthStatus(99, '2026-09', today)?.key).toBe('behind');
    expect(monthStatus(50, '2026-11', today)).toBeNull();
    expect(monthStatus(null, '2026-10', today)).toBeNull();
  });
  it('the key set is the one the page maps to tones', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(['ahead', 'behind', 'hit_margin_missed', 'on_track', 'revenue_hit']);
  });
});
