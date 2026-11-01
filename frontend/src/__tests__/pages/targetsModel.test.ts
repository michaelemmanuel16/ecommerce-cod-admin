import { describe, it, expect } from 'vitest';
import { attainmentStatus, chipText, marginText, validateTarget, type TargetForm } from '../../pages/targets/model';

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
  it('attainmentStatus: 3-point split against the pace; 100% is Hit; no percent has none', () => {
    expect(attainmentStatus(null, 50)).toBeNull();
    expect(attainmentStatus(100, 50)?.label).toBe('Hit');
    expect(attainmentStatus(57, 55)?.label).toBe('On track');
    expect(attainmentStatus(58, 55)?.label).toBe('Ahead');
    expect(attainmentStatus(62, 55)?.label).toBe('Ahead');
    expect(attainmentStatus(44, 55)).toMatchObject({ label: 'Behind', tone: 'bad' });
    expect(attainmentStatus(52, 55)).toMatchObject({ label: 'Behind', tone: 'warn' });
  });
});
