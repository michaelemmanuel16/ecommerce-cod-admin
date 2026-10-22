/** Phone helpers shared by the New order sheet and the customer lookup (F-317, F-362). */

const phoneDigits = (phone: string): string => phone.replace(/\D/g, '');

/** Fewer than 9 digits is an error; a 9-digit Ghana number without the leading 0 is accepted (F-317). */
export const phoneOk = (phone: string): boolean => phoneDigits(phone).length >= 9;

/** Two phones are the same person's when their last 9 digits match (+233245550182 and 0245550182). */
export const samePhone = (a: string | null | undefined, b: string): boolean => {
  const x = phoneDigits(a ?? '');
  const y = phoneDigits(b);
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9);
};
