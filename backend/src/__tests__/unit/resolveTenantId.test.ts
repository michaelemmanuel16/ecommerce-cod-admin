import { describe, it, expect } from '@jest/globals';
import { resolveTenantId, tenantStorage } from '../../utils/tenantContext';

describe('resolveTenantId', () => {
  it('prefers the parent row tenant over the context tenant', () => {
    tenantStorage.run({ tenantId: 'ctx' }, () => {
      expect(resolveTenantId('parent')).toBe('parent');
    });
  });

  it('falls back to the context tenant', () => {
    tenantStorage.run({ tenantId: 'ctx' }, () => {
      expect(resolveTenantId(null)).toBe('ctx');
      expect(resolveTenantId()).toBe('ctx');
    });
  });

  it('throws when there is no tenant anywhere', () => {
    expect(() => resolveTenantId(null)).toThrow('no tenant');
  });
});
