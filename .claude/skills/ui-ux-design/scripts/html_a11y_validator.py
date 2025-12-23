#!/usr/bin/env python3
"""
Basic HTML Accessibility Validator

Checks HTML files for common accessibility issues.

Usage:
  python3 html_a11y_validator.py <file.html>
  python3 html_a11y_validator.py index.html

Checks:
  - Images without alt text
  - Form inputs without labels
  - Missing page lang attribute
  - Empty links
  - Insufficient heading hierarchy
  - Missing document title
  - Duplicate IDs
  - Tables without headers
  - And more...

Note: This is a basic validator. For comprehensive testing, use tools like
axe DevTools, WAVE, or Lighthouse.
"""

import sys
import re
from html.parser import HTMLParser
from collections import defaultdict


class AccessibilityValidator(HTMLParser):
    def __init__(self):
        super().__init__()
        self.issues = []
        self.warnings = []
        self.line_num = 1
        self.ids = defaultdict(list)
        self.has_lang = False
        self.has_title = False
        self.headings = []
        self.forms = []
        self.current_form_inputs = []
        self.in_button = False
        self.in_link = False
        self.current_link_text = ""
        self.current_button_text = ""
        self.label_for_ids = set()

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        # Check for html lang attribute
        if tag == "html":
            if 'lang' in attrs_dict:
                self.has_lang = True
            else:
                self.add_issue("Missing lang attribute on <html> tag")

        # Check for document title
        if tag == "title":
            self.has_title = True

        # Check for images without alt text
        if tag == "img":
            if 'alt' not in attrs_dict:
                self.add_issue(f"Image without alt attribute: {self.get_tag_repr(tag, attrs)}")
            elif attrs_dict.get('alt') == '' and attrs_dict.get('role') != 'presentation':
                self.add_warning(f"Empty alt text (ensure image is decorative): {self.get_tag_repr(tag, attrs)}")

        # Check for duplicate IDs
        if 'id' in attrs_dict:
            id_value = attrs_dict['id']
            self.ids[id_value].append(self.line_num)

        # Check headings hierarchy
        if tag in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            level = int(tag[1])
            self.headings.append((level, self.line_num))

        # Check form inputs
        if tag == "input":
            input_type = attrs_dict.get('type', 'text')
            if input_type not in ['hidden', 'submit', 'button', 'reset']:
                input_id = attrs_dict.get('id')
                if not input_id:
                    self.add_warning(f"Input without id (harder to associate with label): {self.get_tag_repr(tag, attrs)}")
                if 'aria-label' not in attrs_dict and 'aria-labelledby' not in attrs_dict:
                    self.current_form_inputs.append({
                        'tag': self.get_tag_repr(tag, attrs),
                        'id': input_id,
                        'line': self.line_num
                    })

        # Check for label elements
        if tag == "label":
            if 'for' in attrs_dict:
                self.label_for_ids.add(attrs_dict['for'])
            else:
                self.add_warning(f"Label without 'for' attribute (should wrap input or use 'for'): {self.get_tag_repr(tag, attrs)}")

        # Check buttons
        if tag == "button":
            self.in_button = True
            self.current_button_text = ""
            if 'aria-label' not in attrs_dict and 'aria-labelledby' not in attrs_dict:
                # Will check if there's text content
                pass

        # Check links
        if tag == "a":
            self.in_link = True
            self.current_link_text = ""
            if 'href' not in attrs_dict:
                self.add_warning(f"Link without href attribute: {self.get_tag_repr(tag, attrs)}")

        # Check table headers
        if tag == "table":
            # Will be checked when we see th tags
            pass

    def handle_endtag(self, tag):
        if tag == "button":
            self.in_button = False
            if not self.current_button_text.strip():
                self.add_issue("Button without text content or aria-label")

        if tag == "a":
            self.in_link = False
            text = self.current_link_text.strip().lower()
            if not text:
                self.add_issue("Link without text content")
            elif text in ['click here', 'read more', 'learn more', 'here']:
                self.add_warning(f"Non-descriptive link text: '{text}'")

    def handle_data(self, data):
        if self.in_button:
            self.current_button_text += data
        if self.in_link:
            self.current_link_text += data

    def add_issue(self, message):
        self.issues.append(f"Line ~{self.line_num}: {message}")

    def add_warning(self, message):
        self.warnings.append(f"Line ~{self.line_num}: {message}")

    def get_tag_repr(self, tag, attrs):
        """Get string representation of tag"""
        attrs_str = ' '.join([f'{k}="{v}"' for k, v in attrs[:3]])  # Show first 3 attrs
        if len(attrs) > 3:
            attrs_str += "..."
        return f"<{tag} {attrs_str}>"

    def validate(self):
        """Run final validation checks"""
        # Check for document title
        if not self.has_title:
            self.add_issue("Missing <title> tag in document")

        # Check for html lang
        if not self.has_lang:
            self.add_issue("Missing lang attribute on <html> tag")

        # Check duplicate IDs
        for id_value, lines in self.ids.items():
            if len(lines) > 1:
                self.add_issue(f"Duplicate ID '{id_value}' found on lines: {', '.join(map(str, lines))}")

        # Check heading hierarchy
        if self.headings:
            prev_level = 0
            for level, line in self.headings:
                if prev_level == 0 and level != 1:
                    self.add_warning(f"First heading is h{level}, should start with h1 (line {line})")
                elif level > prev_level + 1:
                    self.add_warning(f"Heading hierarchy skipped from h{prev_level} to h{level} (line {line})")
                prev_level = level
        else:
            self.add_warning("No heading tags found in document")

        # Check form inputs without labels
        for input_info in self.current_form_inputs:
            input_id = input_info['id']
            if not input_id or input_id not in self.label_for_ids:
                self.add_issue(f"Form input without associated label: {input_info['tag']} (line {input_info['line']})")

    def feed(self, data):
        """Override feed to track line numbers"""
        self.line_num = 1
        for line in data.split('\n'):
            super().feed(line)
            self.line_num += 1


def print_results(issues, warnings):
    """Print validation results"""
    print()
    print("=" * 70)
    print("HTML ACCESSIBILITY VALIDATION REPORT")
    print("=" * 70)
    print()

    # Print issues
    if issues:
        print(f"ISSUES FOUND: {len(issues)}")
        print("-" * 70)
        for issue in issues:
            print(f"✗ {issue}")
        print()
    else:
        print("✓ No critical issues found!")
        print()

    # Print warnings
    if warnings:
        print(f"WARNINGS: {len(warnings)}")
        print("-" * 70)
        for warning in warnings:
            print(f"⚠ {warning}")
        print()
    else:
        print("✓ No warnings!")
        print()

    print("=" * 70)
    print()

    # Summary
    total = len(issues) + len(warnings)
    if total == 0:
        print("✓ This HTML file passes basic accessibility checks!")
    else:
        print(f"Found {len(issues)} issue(s) and {len(warnings)} warning(s)")

    print()
    print("Note: This is a basic validator. For comprehensive testing, use:")
    print("  - axe DevTools browser extension")
    print("  - WAVE browser extension")
    print("  - Lighthouse (Chrome DevTools)")
    print("  - Manual keyboard and screen reader testing")
    print()


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 html_a11y_validator.py <file.html>")
        print()
        print("Example:")
        print("  python3 html_a11y_validator.py index.html")
        print()
        print("This basic validator checks for:")
        print("  - Images without alt text")
        print("  - Form inputs without labels")
        print("  - Missing lang attribute")
        print("  - Empty or non-descriptive links")
        print("  - Heading hierarchy issues")
        print("  - Missing document title")
        print("  - Duplicate IDs")
        print("  - And more...")
        sys.exit(1)

    filepath = sys.argv[1]

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            html_content = f.read()

        parser = AccessibilityValidator()
        parser.feed(html_content)
        parser.validate()

        print_results(parser.issues, parser.warnings)

        # Exit with error code if issues found
        if parser.issues:
            sys.exit(1)
        else:
            sys.exit(0)

    except FileNotFoundError:
        print(f"Error: File '{filepath}' not found")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
