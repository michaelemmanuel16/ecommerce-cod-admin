/** M8-T11 (COD-73): the campaign status rules, each at its edge. */
import { describe, it, expect } from '@jest/globals';
import { campaignStatus, WINNING_PERCENT_OF_MAX_CPA } from '../../services/marketing/marketingFunnelService';

const base = { paused: false, hasProduct: true, max: '100', spend: '500' };

describe('campaignStatus', () => {
  it('the winning line is one named constant, 85', () => expect(WINNING_PERCENT_OF_MAX_CPA).toBe(85));

  it('exactly 85% of max CPA is Winning; just over is On track', () => {
    expect(campaignStatus({ ...base, cpa: '85' })).toBe('Winning');
    expect(campaignStatus({ ...base, cpa: '85.0001' })).toBe('On track');
    expect(campaignStatus({ ...base, cpa: '10' })).toBe('Winning');
  });

  it('exactly max CPA is On track; just over is Over max CPA', () => {
    expect(campaignStatus({ ...base, cpa: '100' })).toBe('On track');
    expect(campaignStatus({ ...base, cpa: '100.0001' })).toBe('Over max CPA');
  });

  it('spend with no purchase is Over max CPA; no spend and no purchase has no status', () => {
    expect(campaignStatus({ ...base, cpa: null })).toBe('Over max CPA');
    expect(campaignStatus({ ...base, cpa: null, spend: '0' })).toBeNull();
  });

  it('max CPA 0 (no room for ads): any CPA above 0 is Over max CPA', () => {
    expect(campaignStatus({ ...base, max: '0', cpa: '1' })).toBe('Over max CPA');
  });

  it('max CPA not available gives no status, never a guess', () => {
    expect(campaignStatus({ ...base, max: null, cpa: '10' })).toBeNull();
    expect(campaignStatus({ ...base, max: null, cpa: null })).toBeNull();
  });

  it('no product is Not mapped, whatever the numbers', () => {
    expect(campaignStatus({ ...base, hasProduct: false, max: null, cpa: '1' })).toBe('Not mapped');
  });

  it('Paused beats everything', () => {
    expect(campaignStatus({ ...base, paused: true, cpa: '1' })).toBe('Paused');
    expect(campaignStatus({ ...base, paused: true, hasProduct: false, max: null, cpa: null })).toBe('Paused');
    expect(campaignStatus({ ...base, paused: true, max: null, cpa: '500' })).toBe('Paused');
  });
});
