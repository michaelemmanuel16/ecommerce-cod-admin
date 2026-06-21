# Embedding a Checkout Form

This guide covers embedding a published CodAdmin checkout form on any third-party
page. The form is rendered in an iframe and auto-resizes its height to fit the
content via `postMessage`. Width is 100% of its container (capped at 1200px).

You don't need any of this if you only want to link to the hosted form — that's
what the **Copy URL** button gives you. Use embed when you want the form to
appear inline on a page you control (landing page, blog post, etc.).

## What the Copy Embed button copies

```html
<div id="checkout-form-your-slug"></div>
<script>
  (function () {
    var iframe = document.createElement('iframe');
    iframe.src = 'https://your-codadmin-domain/form/your-slug';
    iframe.title = 'Your Form Name';
    iframe.style.width = '100%';
    iframe.style.minHeight = '800px';
    iframe.style.border = 'none';
    iframe.style.maxWidth = '1200px';
    iframe.style.margin = '0 auto';
    iframe.style.display = 'block';
    iframe.setAttribute('scrolling', 'auto');
    iframe.setAttribute('allowtransparency', 'true');

    window.addEventListener('message', function (e) {
      if (e.origin === 'https://your-codadmin-domain' && e.data && e.data.type === 'checkout-resize') {
        iframe.style.height = e.data.height + 'px';
      }
    });

    document.getElementById('checkout-form-your-slug').appendChild(iframe);
  })();
</script>
```

Paste it where you want the checkout to appear. Both the `<div>` and the
`<script>` must be on the same page.

## WordPress

1. Open the page or post editor.
2. Click the **+** button → search for **Custom HTML** block.
3. Paste the embed snippet into the block body.
4. Update or publish.

> Themes that strip `<script>` tags (some block themes, some security plugins)
> will silently drop the snippet. If the form does not appear, install a
> "Custom Code" plugin (e.g. WPCode) and paste the snippet into a code-snippet
> block instead.

## Shopify

1. Go to **Online Store → Pages** in your Shopify admin.
2. Create or edit a page.
3. In the rich-text editor toolbar, click the **`<>` Show HTML** button.
4. Paste the embed snippet into the HTML source.
5. Save the page.

> If Shopify's checkout-protection rules strip the iframe, embed the form on a
> **regular page** (not a checkout-flow page) — the host site's own checkout is
> not in scope.

## Custom HTML / static site / landing page builder

1. Open the page template you want to edit (`.html`, `.njk`, `.liquid`, etc.).
2. Paste the embed snippet inside the `<body>`, at the spot you want the form.
3. Deploy.

For **landing page builders** that have a "Custom HTML" or "Code" block
(Unbounce, ClickFunnels, Webflow, Carrd) — paste the snippet into that block.

## Troubleshooting

- **Nothing appears**: the snippet's `<script>` was stripped. See the WordPress
  note above and check your host's content-security policy.
- **Form appears but doesn't resize**: the parent page's `message` event isn't
  reaching the snippet, usually because of a CSP that blocks inline scripts.
  Move the script to an external file on your origin and load it with a
  `<script src="...">` tag.
- **Form opens but submission fails with CORS / 403**: the form is reaching the
  CodAdmin backend correctly but the slug is inactive or the request is being
  rate-limited. Re-open the form in the admin, make sure it's marked **Active**,
  and check your admin tenant's rate-limit settings.

## When to prefer Copy URL instead

Use the **Copy URL** action when:

- You don't control HTML on the host page (e.g. linking from email, SMS, ads).
- You want analytics / pixel attribution to live in the form's host origin
  (the form domain) rather than the embedding page.
- The host page is mobile-traffic-heavy and the iframe scroll feels worse than
  a clean redirect (common for landing pages on social ads).
