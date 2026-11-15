import { paystackAdapter } from '../../services/payments/paystackAdapter';

describe('Paystack key prefix rule (M9-T27)', () => {
  const check = (mode: string, sk?: string | null, pk?: string | null) => () => paystackAdapter.validateCredentials?.(mode, sk, pk);

  it('accepts sk_test_/pk_test_ for test and sk_live_/pk_live_ for live', () => {
    expect(check('test', 'sk_test_a', 'pk_test_a')).not.toThrow();
    expect(check('live', 'sk_live_a', 'pk_live_a')).not.toThrow();
  });

  it('refuses a secret or a public key of the other mode with 400', () => {
    for (const [mode, sk, pk] of [['test', 'sk_live_a', 'pk_test_a'], ['live', 'sk_live_a', 'pk_test_a'], ['test', 'sk_test_a', 'pk_live_a'], ['live', 'sk_test_a', 'pk_live_a']] as const) {
      expect(check(mode, sk, pk)).toThrow(expect.objectContaining({ statusCode: 400, errorCode: 'PAYSTACK_MODE_KEY_MISMATCH' }));
    }
  });

  it('checks only the key that is given', () => {
    expect(check('live', null, 'pk_live_a')).not.toThrow();
    expect(check('live', 'sk_live_a', null)).not.toThrow();
    expect(check('live', null, 'pk_test_a')).toThrow();
  });
});
