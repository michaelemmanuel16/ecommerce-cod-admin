/** Pure helpers of the New order sheet (F-317). */

export interface DraftLine {
  key: number;
  productId: number | null;
  qty: string;
  price: string;
}

const num = (text: string): number => {
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
};

export const phoneDigits = (phone: string): string => phone.replace(/\D/g, '');

/** Fewer than 9 digits is an error; a 9-digit Ghana number without the leading 0 is accepted (F-317). */
export const phoneOk = (phone: string): boolean => phoneDigits(phone).length >= 9;

/** Two phones are the same person's when their last 9 digits match (+233245550182 and 0245550182). */
export const samePhone = (a: string | null | undefined, b: string): boolean => {
  const x = phoneDigits(a ?? '');
  const y = phoneDigits(b);
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9);
};

export const linesSum = (lines: DraftLine[]): number =>
  lines.reduce((sum, l) => (l.productId ? sum + num(l.qty) * num(l.price) : sum), 0);

/** The total the lines and the discount give. Never below 0. */
export const computedTotal = (lines: DraftLine[], discount: string): number =>
  Math.max(0, Math.round((linesSum(lines) - num(discount)) * 100) / 100);

/** How far the typed total is from the computed one; 0 when they match to the cent. */
export const totalGap = (total: number, computed: number): number => {
  const gap = Math.round(Math.abs(total - computed) * 100) / 100;
  return gap < 0.01 ? 0 : gap;
};

export const asNumber = num;

/** Units asked for per product, over all lines (the same product on two lines counts once). */
export const unitsByProduct = (lines: DraftLine[]): Map<number, number> => {
  const out = new Map<number, number>();
  for (const l of lines) if (l.productId) out.set(l.productId, (out.get(l.productId) ?? 0) + num(l.qty));
  return out;
};
