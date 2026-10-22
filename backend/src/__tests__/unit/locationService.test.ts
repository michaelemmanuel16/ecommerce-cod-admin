import { describe, it, expect } from '@jest/globals';
import { State } from 'country-state-city';
import { getTowns, townsForForm } from '../../services/locationService';
import { GH_TOWNS } from '../../data/towns/GH';

describe('getTowns (COD-138)', () => {
  it('Ghana: own list for Greater Accra', () => {
    const towns = getTowns('GH', 'Greater Accra');
    expect(towns).toEqual(expect.arrayContaining(['Madina', 'Spintex', 'Tema', 'Kasoa']));
    expect(towns).toEqual([...towns].sort((a, b) => a.localeCompare(b)));
  });

  it('Kasoa is listed under both Central and Greater Accra', () => {
    expect(getTowns('GH', 'Central')).toContain('Kasoa');
    expect(getTowns('GH', 'Greater Accra')).toContain('Kasoa');
  });

  it('Ghana: "Greater Accra (Tema)" is Greater Accra; an unknown state has no towns', () => {
    expect(getTowns('GH', 'Greater Accra (Tema)')).toEqual(getTowns('GH', 'Greater Accra'));
    expect(getTowns('GH', 'Atlantis')).toEqual([]);
  });

  it('Nigeria falls back to the library cities', () => {
    const towns = getTowns('NG', 'Lagos');
    expect(towns.length).toBeGreaterThan(0);
    expect(towns).not.toContain('Madina');
  });

  it('has a list for every Ghana state, spelled like the library, and no state name is a town', () => {
    const states = State.getStatesOfCountry('GH').map((s) => s.name);
    expect(Object.keys(GH_TOWNS).sort()).toEqual([...states].sort());
    const lowered = new Set(states.map((s) => s.toLowerCase()));
    for (const [state, towns] of Object.entries(GH_TOWNS)) {
      expect(towns.length).toBeGreaterThan(0);
      expect(new Set(towns.map((t) => t.toLowerCase())).size).toBe(towns.length);
      for (const t of towns) expect(lowered.has(t.toLowerCase())).toBe(false);
      expect(state).toBeTruthy();
    }
  });
});

describe('townsForForm', () => {
  it('covers the states a form offers, for its country name', () => {
    const towns = townsForForm('Ghana', { available: ['Ashanti', 'Greater Accra'] });
    expect(Object.keys(towns)).toEqual(['Ashanti', 'Greater Accra']);
    expect(towns.Ashanti).toContain('Adum');
  });
  it('falls back to every state of the country when the form has no list', () => {
    expect(Object.keys(townsForForm('Ghana', []))).toHaveLength(16);
  });
});
