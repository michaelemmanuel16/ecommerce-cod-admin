import { z } from 'zod';
import { PALETTE_HEX_VALUES, isValidHex, nearestPaletteHex } from '../lib/checkoutPalette';

const paletteHexEnum = z.enum(PALETTE_HEX_VALUES as [string, ...string[]]);

const paletteHexSchema = z.preprocess((val) => {
  if (typeof val !== 'string') return val;
  const normalized = val.trim().toLowerCase();
  if (isValidHex(normalized)) return nearestPaletteHex(normalized);
  return normalized;
}, paletteHexEnum);

const backgroundSchema = z.preprocess((val) => {
  if (typeof val !== 'string') return val;
  const normalized = val.trim().toLowerCase();
  if (normalized === 'transparent') return 'transparent';
  if (isValidHex(normalized)) return nearestPaletteHex(normalized);
  return normalized;
}, z.union([z.literal('transparent'), paletteHexEnum]));

const httpsUrlSchema = z
  .string()
  .max(500, 'Banner URL must be at most 500 characters')
  .refine((v) => v.startsWith('https://'), {
    message: 'Banner URL must start with https://',
  });

export const checkoutFormDesignSchema = z
  .object({
    colors: z
      .object({
        primary: paletteHexSchema.optional(),
        cta: paletteHexSchema.optional(),
        surface: paletteHexSchema.optional(),
        text: paletteHexSchema.optional(),
      })
      .strict()
      .optional(),
    button: z
      .object({
        shape: z.enum(['square', 'rounded', 'pill']).optional(),
        size: z.enum(['sm', 'md', 'lg']).optional(),
        label: z.string().max(60, 'Button label must be at most 60 characters').optional(),
      })
      .strict()
      .optional(),
    input: z
      .object({
        style: z.enum(['flat', 'outlined', 'filled']).optional(),
        labelColor: paletteHexSchema.optional(),
        priceColor: paletteHexSchema.optional(),
      })
      .strict()
      .optional(),
    page: z
      .object({
        background: backgroundSchema.optional(),
        productBanner: httpsUrlSchema.optional(),
        hideProductDisplay: z.boolean().optional(),
        offerPosition: z.enum(['top', 'bottom']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CheckoutFormDesign = z.infer<typeof checkoutFormDesignSchema>;
