#!/usr/bin/env python3
"""
WCAG Color Contrast Checker

Calculates the contrast ratio between two colors and checks WCAG compliance.

Usage:
  python3 color_contrast_checker.py <foreground> <background>
  python3 color_contrast_checker.py "#000000" "#FFFFFF"
  python3 color_contrast_checker.py "rgb(0,0,0)" "rgb(255,255,255)"
  python3 color_contrast_checker.py "000000" "FFFFFF"

WCAG Requirements:
  - Normal text (AA): 4.5:1 minimum
  - Large text (AA): 3:1 minimum (18pt+ or 14pt+ bold)
  - UI components (AA): 3:1 minimum
"""

import sys
import re


def parse_color(color_string):
    """Parse color from various formats (hex, rgb, rgba)"""
    color = color_string.strip().lower()

    # Remove # if present
    color = color.lstrip('#')

    # Hex format (3 or 6 digits)
    if re.match(r'^[0-9a-f]{3}$', color):
        # Convert 3-digit hex to 6-digit
        color = ''.join([c*2 for c in color])

    if re.match(r'^[0-9a-f]{6}$', color):
        r = int(color[0:2], 16)
        g = int(color[2:4], 16)
        b = int(color[4:6], 16)
        return (r, g, b)

    # RGB/RGBA format
    rgb_match = re.match(r'rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', color)
    if rgb_match:
        r, g, b = map(int, rgb_match.groups())
        return (r, g, b)

    raise ValueError(f"Invalid color format: {color_string}")


def relative_luminance(rgb):
    """
    Calculate relative luminance according to WCAG formula
    https://www.w3.org/TR/WCAG20/#relativeluminancedef
    """
    r, g, b = rgb

    # Convert to 0-1 range
    r = r / 255.0
    g = g / 255.0
    b = b / 255.0

    # Apply gamma correction
    def gamma_correct(c):
        if c <= 0.03928:
            return c / 12.92
        else:
            return ((c + 0.055) / 1.055) ** 2.4

    r = gamma_correct(r)
    g = gamma_correct(g)
    b = gamma_correct(b)

    # Calculate luminance
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return luminance


def contrast_ratio(color1, color2):
    """
    Calculate contrast ratio between two colors
    https://www.w3.org/TR/WCAG20/#contrast-ratiodef
    """
    lum1 = relative_luminance(color1)
    lum2 = relative_luminance(color2)

    # Ensure lighter color is in numerator
    lighter = max(lum1, lum2)
    darker = min(lum1, lum2)

    ratio = (lighter + 0.05) / (darker + 0.05)
    return ratio


def check_wcag_compliance(ratio):
    """Check WCAG AA and AAA compliance levels"""
    results = {
        'ratio': ratio,
        'aa_normal': ratio >= 4.5,
        'aa_large': ratio >= 3.0,
        'aa_ui': ratio >= 3.0,
        'aaa_normal': ratio >= 7.0,
        'aaa_large': ratio >= 4.5,
    }
    return results


def format_color_name(rgb):
    """Convert RGB to hex for display"""
    return f"#{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"


def print_results(fg_color, bg_color, results):
    """Print formatted results"""
    fg_name = format_color_name(fg_color)
    bg_name = format_color_name(bg_color)
    ratio = results['ratio']

    print()
    print("=" * 60)
    print("WCAG COLOR CONTRAST CHECKER")
    print("=" * 60)
    print()
    print(f"Foreground: {fg_name} (RGB{fg_color})")
    print(f"Background: {bg_name} (RGB{bg_color})")
    print()
    print(f"Contrast Ratio: {ratio:.2f}:1")
    print()
    print("-" * 60)
    print("WCAG AA Compliance:")
    print("-" * 60)

    # Normal text
    status = "✓ PASS" if results['aa_normal'] else "✗ FAIL"
    print(f"  Normal text (4.5:1):          {status}")

    # Large text
    status = "✓ PASS" if results['aa_large'] else "✗ FAIL"
    print(f"  Large text (3:1):             {status}")
    print(f"    (18pt+ or 14pt+ bold)")

    # UI components
    status = "✓ PASS" if results['aa_ui'] else "✗ FAIL"
    print(f"  UI components (3:1):          {status}")

    print()
    print("-" * 60)
    print("WCAG AAA Compliance:")
    print("-" * 60)

    # Normal text AAA
    status = "✓ PASS" if results['aaa_normal'] else "✗ FAIL"
    print(f"  Normal text (7:1):            {status}")

    # Large text AAA
    status = "✓ PASS" if results['aaa_large'] else "✗ FAIL"
    print(f"  Large text (4.5:1):           {status}")

    print()
    print("=" * 60)

    # Overall recommendation
    print()
    if results['aa_normal']:
        print("✓ This color combination meets WCAG AA standards for all text sizes.")
    elif results['aa_large']:
        print("⚠ This color combination only meets WCAG AA for large text (18pt+ or 14pt+ bold).")
        print(f"  You need a ratio of at least 4.5:1 for normal text (current: {ratio:.2f}:1)")
    else:
        print("✗ This color combination does NOT meet WCAG AA standards.")
        print(f"  Minimum ratio needed:")
        print(f"    - Normal text: 4.5:1 (current: {ratio:.2f}:1)")
        print(f"    - Large text: 3:1 (current: {ratio:.2f}:1)")
    print()


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 color_contrast_checker.py <foreground> <background>")
        print()
        print("Examples:")
        print('  python3 color_contrast_checker.py "#000000" "#FFFFFF"')
        print('  python3 color_contrast_checker.py "rgb(0,0,0)" "rgb(255,255,255)"')
        print('  python3 color_contrast_checker.py "000000" "FFFFFF"')
        print()
        print("Supported formats:")
        print("  - Hex: #RRGGBB or RRGGBB (e.g., #FF5733 or FF5733)")
        print("  - Hex short: #RGB or RGB (e.g., #F53 or F53)")
        print("  - RGB: rgb(R, G, B) (e.g., rgb(255, 87, 51))")
        print("  - RGBA: rgba(R, G, B, A) (alpha channel ignored)")
        sys.exit(1)

    try:
        fg_input = sys.argv[1]
        bg_input = sys.argv[2]

        fg_color = parse_color(fg_input)
        bg_color = parse_color(bg_input)

        ratio = contrast_ratio(fg_color, bg_color)
        results = check_wcag_compliance(ratio)

        print_results(fg_color, bg_color, results)

    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
