// WCAG 2.x contrast ratio between two hex colours (F-417). Used for the button warning on the Design tab.

/** The text colour of the checkout button (white on the button colour). */
const BUTTON_TEXT_COLOR = '#ffffff';
/** The button colour of a form with no CTA colour set (the public form's default). */
export const DEFAULT_BUTTON_COLOR = '#0f172a';
const MIN_TEXT_CONTRAST = 4.5;

function channels(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 1 (same colour) to 21 (black on white). NaN when either colour is not a hex colour. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = channels(hexA);
  const b = channels(hexB);
  if (!a || !b) return NaN;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** True when the button text would be hard to read on this button colour. A colour that is not a hex colour never warns. */
export function buttonContrastLow(buttonHex: string): boolean {
  const ratio = contrastRatio(buttonHex, BUTTON_TEXT_COLOR);
  return !Number.isNaN(ratio) && ratio < MIN_TEXT_CONTRAST;
}
