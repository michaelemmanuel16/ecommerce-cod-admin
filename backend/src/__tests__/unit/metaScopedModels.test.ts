import { describe, it, expect } from '@jest/globals';
import { TENANT_SCOPED_MODELS } from '../../utils/prismaExtensions';

describe('M8 marketing models are tenant scoped', () => {
  it.each(['MetaAdAccount', 'MetaSpendDay', 'MetaCampaignMapping'])('%s is in the scoped list', (model) => {
    expect(TENANT_SCOPED_MODELS.has(model)).toBe(true);
  });
});
