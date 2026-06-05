/**
 * Builds the JS auto-resize embed snippet for a checkout form. This is the
 * "Method 2" variant from the deprecated EmbedCodeModal: 100% width, height
 * grows to match the iframe's content via postMessage. No tenant-tunable
 * dimensions (E6 of MAN-67).
 *
 * The slug is HTML-escaped before interpolation so a malicious slug cannot
 * break out of the script tag.
 */

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return c;
    }
  });

const escapeJsString = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');

export interface EmbedSnippetForm {
  slug: string;
  name?: string;
}

export const formUrl = (slug: string, origin: string = window.location.origin): string =>
  `${origin}/form/${slug}`;

export const buildEmbedSnippet = (
  form: EmbedSnippetForm,
  origin: string = window.location.origin
): string => {
  const safeSlug = escapeHtml(form.slug);
  const jsSlug = escapeJsString(form.slug);
  const jsOrigin = escapeJsString(origin);
  const title = escapeJsString(form.name || form.slug);
  const url = `${origin}/form/${jsSlug}`;
  const containerId = `checkout-form-${safeSlug}`;

  return `<div id="${containerId}"></div>
<script>
  (function() {
    var iframe = document.createElement('iframe');
    iframe.src = '${url}';
    iframe.title = '${title}';
    iframe.style.width = '100%';
    iframe.style.minHeight = '800px';
    iframe.style.border = 'none';
    iframe.style.maxWidth = '1200px';
    iframe.style.margin = '0 auto';
    iframe.style.display = 'block';
    iframe.setAttribute('scrolling', 'auto');
    iframe.setAttribute('allowtransparency', 'true');

    window.addEventListener('message', function(e) {
      if (e.origin === '${jsOrigin}' && e.data && e.data.type === 'checkout-resize') {
        iframe.style.height = e.data.height + 'px';
      }
    });

    document.getElementById('${containerId}').appendChild(iframe);
  })();
</script>`;
};
