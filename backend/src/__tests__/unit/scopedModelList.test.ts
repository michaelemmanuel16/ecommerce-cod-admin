import { describe, it, expect } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { TENANT_SCOPED_MODELS } from '../../utils/prismaExtensions';

// Child rows are scoped through their parent. A direct read must filter on the parent tenant.
const CHILD_ROWS = ['OrderItem', 'FormPackage', 'FormUpsell'];

describe('scopedModelList', () => {
  const models = Prisma.dmmf.datamodel.models;

  it('lists every Prisma model that has a tenantId field', () => {
    const missing = models
      .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
      .map((m) => m.name)
      .filter((name) => !TENANT_SCOPED_MODELS.has(name));
    expect(missing).toEqual([]);
  });

  it('has only real model names that carry a tenantId field', () => {
    const withTenant = new Set(
      models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name)
    );
    const unknown = [...TENANT_SCOPED_MODELS].filter((name) => !withTenant.has(name));
    expect(unknown).toEqual([]);
  });

  it('does not list the child row models', () => {
    for (const name of CHILD_ROWS) expect(TENANT_SCOPED_MODELS.has(name)).toBe(false);
  });
});
