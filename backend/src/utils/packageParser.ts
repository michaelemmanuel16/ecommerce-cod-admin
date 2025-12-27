/**
 * Package Parser Utility
 *
 * Parses package/quantity fields from WPForms webhooks that contain
 * combined product package, quantity, and price information.
 *
 * Supported patterns:
 * - "BUY ONE SET - GH₵250" / "BUY TWO SETS - GH₵450"
 * - "BUY ONE: GHC250" / "BUY TWO: GHC450"
 * - "BUY 1 GET 1 (2PCS): GHC250" / "BUY 2 GET 2 (4PCS): GHC450"
 */

export interface ParsedPackage {
  quantity: number;
  price: number;
  rawPackage: string;
}

/**
 * Parse a package field string to extract quantity and price
 *
 * @param packageStr - The raw package string from webhook
 * @returns ParsedPackage with extracted quantity, price, and original string
 *
 * @example
 * parsePackageField("BUY TWO SETS - GH₵450")
 * // Returns: { quantity: 2, price: 450, rawPackage: "BUY TWO SETS - GH₵450" }
 *
 * parsePackageField("BUY 2 GET 2 (4PCS): GHC450")
 * // Returns: { quantity: 4, price: 450, rawPackage: "BUY 2 GET 2 (4PCS): GHC450" }
 */
export function parsePackageField(packageStr: string): ParsedPackage {
  if (!packageStr || typeof packageStr !== 'string') {
    return {
      quantity: 1,
      price: 0,
      rawPackage: packageStr || ''
    };
  }

  const quantity = extractQuantity(packageStr);
  const price = extractPrice(packageStr);

  return {
    quantity,
    price,
    rawPackage: packageStr
  };
}

/**
 * Extract quantity from package string
 * Handles word numbers (ONE, TWO, THREE) and digit patterns
 * For "BUY X GET X (NPCS)" patterns, extracts total pieces count
 */
function extractQuantity(str: string): number {
  // Map word numbers and digits to values
  const numberMap: Record<string, number> = {
    'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5,
    'SIX': 6, 'SEVEN': 7, 'EIGHT': 8, 'NINE': 9, 'TEN': 10,
    '1': 1, '2': 2, '3': 3, '4': 4, '5': 5,
    '6': 6, '7': 7, '8': 8, '9': 9, '10': 10
  };

  const upperStr = str.toUpperCase();

  // Priority 1: Check for "BUY X GET X (NPCS)" pattern - extract total pieces
  const pcsMatch = upperStr.match(/\((\d+)\s*PCS\)/i);
  if (pcsMatch) {
    return parseInt(pcsMatch[1], 10);
  }

  // Priority 2: Check for "BUY NUMBER" pattern (word or digit)
  for (const [key, value] of Object.entries(numberMap)) {
    if (upperStr.includes(`BUY ${key}`)) {
      return value;
    }
  }

  // Priority 3: Try to find any number in the string
  const anyNumberMatch = str.match(/\d+/);
  if (anyNumberMatch) {
    return parseInt(anyNumberMatch[0], 10);
  }

  // Default to 1 if no quantity found
  return 1;
}

/**
 * Extract price from package string
 * Supports formats: GH₵450, GHC450, GHS450, GHC 450
 */
function extractPrice(str: string): number {
  // Match various Ghana Cedi formats
  // GH₵450, GHC450, GHS450, GHC 450
  const priceMatch = str.match(/GH[C₵S]?\s*(\d+)/i);

  if (priceMatch) {
    return parseInt(priceMatch[1], 10);
  }

  // Fallback: try to find a number that looks like a price (2-4 digits)
  const fallbackMatch = str.match(/\b(\d{2,4})\b/);
  if (fallbackMatch) {
    return parseInt(fallbackMatch[1], 10);
  }

  // Default to 0 if no price found
  return 0;
}

/**
 * Validate if a package string can be parsed successfully
 * Returns true if both quantity and price can be extracted
 */
export function isValidPackageString(packageStr: string): boolean {
  const parsed = parsePackageField(packageStr);
  return parsed.quantity > 0 && parsed.price > 0;
}
