import { describe, it, expect } from '@jest/globals';
import { findTown, planTown } from '../../scripts/backfillTowns';
import { getTowns } from '../../services/locationService';

const townsOf = (state: string) => getTowns('GH', state);

describe('backfill matcher (COD-138)', () => {
  it('finds the town in an address, whole word, any case', () => {
    expect(planTown('Greater Accra', 'Greater Accra', 'Dansoman control', townsOf)).toBe('Dansoman');
    expect(planTown('', 'Greater Accra', 'house 4, DANSOMAN last stop', townsOf)).toBe('Dansoman');
    expect(findTown('Madinaville', ['Madina'])).toBeNull();
  });

  it('takes the town that appears first in the text', () => {
    expect(planTown('Ashanti', 'Ashanti', 'Aboabo kumasi', townsOf)).toBe('Aboabo');
    expect(planTown('Ashanti', 'Ashanti', 'Kumasi near Aboabo', townsOf)).toBe('Kumasi');
  });

  it('at the same spot the longer name wins', () => {
    expect(findTown('New Tafo junction', ['Tafo', 'New Tafo'])).toBe('New Tafo');
  });

  it('a region-only value with no match becomes empty; an empty value with no match is left alone', () => {
    expect(planTown('Ashanti', 'Ashanti', 'behind the big church', townsOf)).toBe('');
    expect(planTown('', 'Ashanti', 'behind the big church', townsOf)).toBeUndefined();
  });

  it('only matches the towns of the row own state; "Greater Accra (Tema)" counts as Greater Accra', () => {
    expect(planTown('Ashanti', 'Ashanti', 'Madina market', townsOf)).toBe('');
    expect(planTown('Greater Accra (Tema)', 'Greater Accra (Tema)', 'Community 1, Tema', townsOf)).toBe('Tema');
  });

  it('leaves a row that already has a real town alone', () => {
    expect(planTown('Osu', 'Greater Accra', 'Madina', townsOf)).toBeUndefined();
  });

  it('a second run changes nothing', () => {
    const rows = [
      { area: 'Greater Accra', state: 'Greater Accra', text: 'Dansoman control' },
      { area: 'Ashanti', state: 'Ashanti', text: 'behind the big church' },
      { area: '', state: 'Ashanti', text: 'Aboabo kumasi' },
      { area: '', state: 'Volta', text: 'nothing here' },
    ];
    const run = () => rows.filter((r) => {
      const to = planTown(r.area, r.state, r.text, townsOf);
      if (to === undefined) return false;
      r.area = to;
      return true;
    }).length;
    expect(run()).toBe(3);
    expect(rows.map((r) => r.area)).toEqual(['Dansoman', '', 'Aboabo', '']);
    expect(run()).toBe(0);
  });
});
