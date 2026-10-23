import { describe, it, expect } from '@jest/globals';
import { checkoutFormDesignSchema } from '../checkoutFormDesignSchema';
import { BRAND_PALETTE } from '../../lib/checkoutPalette';

describe('checkoutFormDesignSchema', () => {
  const paletteHex = BRAND_PALETTE[0].hex; // #0f172a

  describe('colors', () => {
    it('accepts a palette-exact hex', () => {
      const result = checkoutFormDesignSchema.safeParse({
        colors: { cta: paletteHex },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.colors?.cta).toBe(paletteHex);
      }
    });

    it('snaps a near-palette hex to the nearest swatch', () => {
      // #0f172b is one channel away from #0f172a (charcoal)
      const result = checkoutFormDesignSchema.safeParse({
        colors: { cta: '#0f172b' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.colors?.cta).toBe('#0f172a');
      }
    });

    it('snaps an off-palette hex to the nearest palette swatch', () => {
      // Bright red #ff0000 should snap to palette red #dc2626
      const result = checkoutFormDesignSchema.safeParse({
        colors: { cta: '#ff0000' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.colors?.cta).toBe('#dc2626');
      }
    });

    it('rejects a non-hex color string', () => {
      const result = checkoutFormDesignSchema.safeParse({
        colors: { cta: 'red' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects javascript: in a color field', () => {
      const result = checkoutFormDesignSchema.safeParse({
        colors: { cta: 'javascript:alert(1)' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('button.shape', () => {
    it('accepts each enum value', () => {
      for (const shape of ['square', 'rounded', 'pill'] as const) {
        const result = checkoutFormDesignSchema.safeParse({ button: { shape } });
        expect(result.success).toBe(true);
      }
    });

    it('rejects an unknown shape', () => {
      const result = checkoutFormDesignSchema.safeParse({
        button: { shape: 'circle' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('button.size', () => {
    it('accepts each enum value', () => {
      for (const size of ['sm', 'md', 'lg'] as const) {
        const result = checkoutFormDesignSchema.safeParse({ button: { size } });
        expect(result.success).toBe(true);
      }
    });

    it('rejects an unknown size', () => {
      const result = checkoutFormDesignSchema.safeParse({
        button: { size: 'xl' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('button.label', () => {
    it('accepts a 60-char label', () => {
      const label = 'a'.repeat(60);
      const result = checkoutFormDesignSchema.safeParse({ button: { label } });
      expect(result.success).toBe(true);
    });

    it('rejects a 61-char label', () => {
      const label = 'a'.repeat(61);
      const result = checkoutFormDesignSchema.safeParse({ button: { label } });
      expect(result.success).toBe(false);
    });
  });

  describe('input.style', () => {
    it('accepts each enum value', () => {
      for (const style of ['flat', 'outlined', 'filled'] as const) {
        const result = checkoutFormDesignSchema.safeParse({ input: { style } });
        expect(result.success).toBe(true);
      }
    });

    it('rejects an unknown style', () => {
      const result = checkoutFormDesignSchema.safeParse({
        input: { style: 'fancy' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('page.background', () => {
    it('accepts "transparent"', () => {
      const result = checkoutFormDesignSchema.safeParse({
        page: { background: 'transparent' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts a palette hex', () => {
      const result = checkoutFormDesignSchema.safeParse({
        page: { background: paletteHex },
      });
      expect(result.success).toBe(true);
    });

    it('rejects an arbitrary keyword', () => {
      const result = checkoutFormDesignSchema.safeParse({
        page: { background: 'white' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('page.productBanner', () => {
    it('accepts an https URL', () => {
      const result = checkoutFormDesignSchema.safeParse({
        page: { productBanner: 'https://cdn.example.com/banner.png' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects an http URL', () => {
      const result = checkoutFormDesignSchema.safeParse({
        page: { productBanner: 'http://cdn.example.com/banner.png' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a javascript: URL', () => {
      const result = checkoutFormDesignSchema.safeParse({
        page: { productBanner: 'javascript:alert(1)' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects a URL longer than 500 chars', () => {
      const url = 'https://example.com/' + 'a'.repeat(490);
      const result = checkoutFormDesignSchema.safeParse({
        page: { productBanner: url },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('page.offerPosition', () => {
    it('accepts top and bottom', () => {
      for (const offerPosition of ['top', 'bottom'] as const) {
        const result = checkoutFormDesignSchema.safeParse({ page: { offerPosition } });
        expect(result.success).toBe(true);
      }
    });

    it('rejects an unknown position', () => {
      const result = checkoutFormDesignSchema.safeParse({
        page: { offerPosition: 'left' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('strict mode', () => {
    it('rejects unknown top-level keys', () => {
      const result = checkoutFormDesignSchema.safeParse({
        colors: { cta: paletteHex },
        unknown: 'extra',
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown keys nested inside colors', () => {
      const result = checkoutFormDesignSchema.safeParse({
        colors: { hover: paletteHex },
      });
      expect(result.success).toBe(false);
    });
  });

  it('accepts an empty object', () => {
    const result = checkoutFormDesignSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a full payload', () => {
    const result = checkoutFormDesignSchema.safeParse({
      colors: {
        primary: paletteHex,
        cta: '#dc2626',
        surface: '#0d9488',
        text: '#000000',
      },
      button: { shape: 'pill', size: 'lg', label: 'Place Order' },
      input: { style: 'outlined', labelColor: paletteHex, priceColor: '#dc2626' },
      page: {
        background: 'transparent',
        productBanner: 'https://cdn.example.com/banner.png',
        hideProductDisplay: false,
        offerPosition: 'top',
      },
    });
    expect(result.success).toBe(true);
  });
});
