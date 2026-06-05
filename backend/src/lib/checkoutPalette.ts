export interface PaletteSwatch {
  name: string;
  hex: string;
}

export const BRAND_PALETTE: readonly PaletteSwatch[] = [
  { name: 'Charcoal', hex: '#0f172a' },
  { name: 'Slate', hex: '#475569' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Purple', hex: '#7c3aed' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Red', hex: '#dc2626' },
  { name: 'Rose', hex: '#e11d48' },
  { name: 'Pink', hex: '#db2777' },
  { name: 'Black', hex: '#000000' },
] as const;

export const PALETTE_HEX_VALUES: readonly string[] = BRAND_PALETTE.map((s) => s.hex);

const HEX_RE = /^#([0-9a-f]{6})$/i;

export function isPaletteHex(value: string): boolean {
  return PALETTE_HEX_VALUES.includes(value.toLowerCase());
}

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(HEX_RE);
  if (!m) throw new Error(`invalid hex: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function nearestPaletteHex(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (isPaletteHex(normalized)) return normalized;
  if (!isValidHex(normalized)) return BRAND_PALETTE[0].hex;
  const [r, g, b] = hexToRgb(normalized);
  let best = BRAND_PALETTE[0].hex;
  let bestDist = Infinity;
  for (const swatch of BRAND_PALETTE) {
    const [pr, pg, pb] = hexToRgb(swatch.hex);
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = swatch.hex;
    }
  }
  return best;
}
