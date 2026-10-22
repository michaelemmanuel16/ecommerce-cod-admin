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
