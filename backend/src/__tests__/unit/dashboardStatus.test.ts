/**
 * M3-T09 (F-202, F-203, F-204): status tags of the Dashboard. The 3-point split, the pace chip and the quest tones.
 */
import { describe, it, expect } from '@jest/globals';
import { changePercent, paceChip, progressTag, questPercent, questTone, rateTag } from '../../services/kpi/status';

describe('progressTag (F-202): progress against the pace marker', () => {
  it('fixture 17 October: quarter 17 vs 18.5 is behind, month 51.1 vs 54.8 is off track, year 76.8 vs 79.5 is behind', () => {
    expect(progressTag(17, 18.5)).toBe('behind');
    expect(progressTag(51.1, 54.8)).toBe('off_track');
    expect(progressTag(76.8, 79.5)).toBe('behind');
  });

  it('at or above the pace is on track; 3.0 points under is off track, 2.9 is behind (no float drift)', () => {
    expect(progressTag(54.8, 54.8)).toBe('on_track');
    expect(progressTag(60, 54.8)).toBe('on_track');
    expect(progressTag(51.8, 54.8)).toBe('off_track'); // 54.8 - 51.8 is 2.9999999999999964 in floats
    expect(progressTag(51.9, 54.8)).toBe('behind');
  });

  it('100 percent or more is hit; no target is no_target', () => {
    expect(progressTag(100, 55)).toBe('hit');
    expect(progressTag(130.4, 55)).toBe('hit');
    expect(progressTag(null, 55)).toBe('no_target');
  });
});

describe('rateTag (F-204)', () => {
  it('confirmation 71 vs 70 is on track; delivery success 48.3 vs 60 is off track; 58 vs 60 is behind', () => {
    expect(rateTag(71, 70)).toBe('on_track');
    expect(rateTag(48.3, 60)).toBe('off_track');
    expect(rateTag(58, 60)).toBe('behind');
    expect(rateTag(null, 60)).toBe('no_data');
  });
});

describe('paceChip (F-202)', () => {
  it('76.8 against a pace of 79.5 is "3 pts behind"', () => {
    expect(paceChip(76.8, 79.5)).toEqual({ points: 3, tag: 'behind' });
  });
  it('ahead, on pace and no target', () => {
    expect(paceChip(84, 79.5)).toEqual({ points: 5, tag: 'ahead' });
    expect(paceChip(79.6, 79.5)).toEqual({ points: 0, tag: 'on_pace' });
    expect(paceChip(null, 79.5)).toBeNull();
  });
});

describe('quests (F-203)', () => {
  it('tones: green at or above target, gold 50 to 99 percent, coral under 50', () => {
    expect(questTone(questPercent(64, 56))).toBe('ok');
    expect(questTone(questPercent(4200, 6286))).toBe('warn');
    expect(questTone(questPercent(6, 15))).toBe('bad');
    expect(questTone(null)).toBe('bad');
  });
  it('a target of 0 has no percent', () => {
    expect(questPercent(3, 0)).toBeNull();
    expect(questPercent(3, null)).toBeNull();
  });
});

describe('changePercent (F-204)', () => {
  it('64 against 54 last Friday is up 19 percent; no orders last week is null', () => {
    expect(changePercent(64, 54)).toBe(19);
    expect(changePercent(40, 50)).toBe(-20);
    expect(changePercent(5, 0)).toBeNull();
  });
});
