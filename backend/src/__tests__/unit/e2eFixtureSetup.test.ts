import { refusal } from '../../../scripts/e2e-fixture-setup';

describe('e2e fixture setup guard (M4-T30)', () => {
  const local = 'postgresql://u:p@localhost:5432/ecommerce_cod_test_b';

  it('allows a local test database outside production', () => {
    expect(refusal(local, 'development')).toBeNull();
    expect(refusal(local, undefined)).toBeNull();
  });

  it('refuses production, a missing url, a bad url, a remote host and a database that is not a test database', () => {
    expect(refusal(local, 'production')).toMatch(/production/);
    expect(refusal(undefined, 'test')).toMatch(/not set/);
    expect(refusal('nonsense', 'test')).toMatch(/not a valid URL/);
    expect(refusal('postgresql://u:p@db.example.com:5432/ecommerce_cod_test_b', 'test')).toMatch(/not local/);
    expect(refusal('postgresql://u:p@localhost:5432/ecommerce_cod', 'test')).toMatch(/not a test database/);
    expect(refusal('postgresql://u:p@localhost:5432/ecommerce_cod_m3copy', 'test')).toMatch(/not a test database/);
  });
});
