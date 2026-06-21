import { describe, it, expect } from 'vitest';
import { buildEmbedSnippet, buildWidgetSnippet, formUrl } from '../../lib/embedSnippet';

describe('formUrl', () => {
  it('joins origin and slug', () => {
    expect(formUrl('magic-groove', 'https://app.example.com')).toBe(
      'https://app.example.com/form/magic-groove'
    );
  });
});

describe('buildEmbedSnippet', () => {
  const origin = 'https://app.example.com';

  it('includes the form URL and slug-derived container ID', () => {
    const out = buildEmbedSnippet({ slug: 'magic-groove' }, origin);
    expect(out).toContain('https://app.example.com/form/magic-groove');
    expect(out).toContain('id="checkout-form-magic-groove"');
    expect(out).toContain("getElementById('checkout-form-magic-groove')");
  });

  it('wires the auto-resize message listener to the origin', () => {
    const out = buildEmbedSnippet({ slug: 's' }, 'https://app.example.com');
    expect(out).toContain("e.origin === 'https://app.example.com'");
    expect(out).toContain("e.data.type === 'checkout-resize'");
  });

  it('uses 100% width and auto-grow height (no tenant customization)', () => {
    const out = buildEmbedSnippet({ slug: 's' }, origin);
    expect(out).toContain("iframe.style.width = '100%'");
    expect(out).toContain("iframe.style.minHeight = '800px'");
    expect(out).toContain("iframe.style.height = e.data.height + 'px'");
  });

  it('HTML-escapes slugs to prevent script breakout in the container div', () => {
    const out = buildEmbedSnippet({ slug: 'a"><script>x</script>' }, origin);
    expect(out).not.toMatch(/<div id="checkout-form-a"><script>/);
    expect(out).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('JS-escapes `<` so a slug containing </script> cannot terminate the script block', () => {
    const out = buildEmbedSnippet({ slug: 'foo</script><script>alert(1)//' }, origin);
    // The literal characters `</script>` must NOT appear inside the JS string
    // assignment to iframe.src — they would close the surrounding script tag.
    const iframeSrcLine = out.split('\n').find((l) => l.includes('iframe.src =')) || '';
    expect(iframeSrcLine).not.toContain('</script>');
    expect(iframeSrcLine).toContain('\\u003c');
  });

  it('JS-escapes single quotes in slugs', () => {
    const out = buildEmbedSnippet({ slug: "it's" }, origin);
    expect(out).toContain("/form/it\\'s");
  });

  it('uses the form name as iframe title when provided', () => {
    const out = buildEmbedSnippet({ slug: 's', name: 'My Form' }, origin);
    expect(out).toContain("iframe.title = 'My Form'");
  });

  it('falls back to slug for title when name is missing', () => {
    const out = buildEmbedSnippet({ slug: 'magic-groove' }, origin);
    expect(out).toContain("iframe.title = 'magic-groove'");
  });
});

describe('buildWidgetSnippet', () => {
  const origin = 'https://app.example.com';

  it('renders the Mode A container + embed.js script tag', () => {
    const out = buildWidgetSnippet({ slug: 'magic-groove' }, origin);
    expect(out).toContain('data-codadmin-checkout data-slug="magic-groove"');
    expect(out).toContain('<script src="https://app.example.com/embed.js" defer></script>');
  });

  it('omits package-lock attributes when no package id is given', () => {
    const out = buildWidgetSnippet({ slug: 's' }, origin);
    expect(out).not.toContain('data-package');
    expect(out).not.toContain('data-lock');
  });

  it('adds data-package + data-lock when a package id is given', () => {
    const out = buildWidgetSnippet({ slug: 's' }, origin, 12);
    expect(out).toContain('data-package="12" data-lock="1"');
  });

  it('ignores a non-positive package id', () => {
    const out = buildWidgetSnippet({ slug: 's' }, origin, 0);
    expect(out).not.toContain('data-package');
  });

  it('HTML-escapes the slug in the container attribute', () => {
    const out = buildWidgetSnippet({ slug: 'a"><script>x</script>' }, origin);
    expect(out).not.toContain('data-slug="a"><script>');
    expect(out).toContain('&quot;&gt;&lt;script&gt;');
  });
});
