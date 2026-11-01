import { describe, it, expect } from 'vitest';
import { STATUS_TONE, barClass, chipText, marginText, northStarTag, validateTarget, type TargetForm } from '../../pages/targets/model';
import { TREE } from '../fixtures/targetsTree';

const form = (patch: Partial<TargetForm> = {}): TargetForm => ({ scope: 'role', roleId: '7', userId: '', metric: 'revenue', period: '2026-10', value: '100', ...patch });

describe('targets model', () => {
  it('validateTarget: value more than 0, role, person, period, metric', () => {
    expect(validateTarget(form())).toEqual({});
    expect(validateTarget(form({ value: '0' })).value).toBeDefined();
    expect(validateTarget(form({ value: '-3' })).value).toBeDefined();
    expect(validateTarget(form({ value: '' })).value).toBeDefined();
    expect(validateTarget(form({ roleId: '' })).roleId).toBeDefined();
    expect(validateTarget(form({ scope: 'person' })).userId).toBeDefined();
    expect(validateTarget(form({ scope: 'person', userId: '5' }))).toEqual({});
    expect(validateTarget(form({ period: '2026-13' })).period).toBeDefined();
    expect(validateTarget(form({ scope: 'daily', roleId: '', metric: 'failed_delivery_calls_per_day', period: '2026-10-17' }))).toEqual({});
    expect(validateTarget(form({ scope: 'daily', roleId: '', metric: 'revenue', period: '2026-10-17' })).metric).toBeDefined();
  });
  it('words', () => {
    expect(marginText(null, 35)).toBe('n/a');
    expect(marginText(11.6, 35)).toBe('12% of 35%');
    expect(chipText({ points: 3, tag: 'behind' })).toBe('3 pts behind');
    expect(chipText({ points: 1, tag: 'ahead' })).toBe('1 pt ahead');
    expect(chipText({ points: 0, tag: 'on_pace' })).toBe('on pace');
  });
  it('STATUS_TONE has exactly the keys of the backend TargetStatus (services/targetStatus.ts); bars take the tone of the key', () => {
    expect(Object.keys(STATUS_TONE).sort()).toEqual(['ahead', 'behind', 'hit_margin_missed', 'on_track', 'revenue_hit']);
    expect(STATUS_TONE.behind).toBe('warn');
    expect(barClass(STATUS_TONE.behind)).toBe('gold');
    expect(barClass(STATUS_TONE.ahead)).toBe('');
  });
  it('the North Star pill is gold when behind the pace and green when ahead', () => {
    const ns = TREE.northStar!;
    expect(northStarTag(ns, 35)).toMatchObject({ text: '77% done · 3 pts behind · margin 12% of 35%', tone: 'warn' });
    expect(northStarTag({ ...ns, actuals: { ...ns.actuals!, chip: { points: 1, tag: 'ahead' } } }, 35)?.tone).toBe('ok');
  });
});
