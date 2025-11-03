import React, { useState } from 'react';
import { X, Copy, Check, Code2, Globe } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CheckoutForm } from '../../types/checkout-form';

interface EmbedCodeModalProps {
  isOpen: boolean;
  form: CheckoutForm | null;
  onClose: () => void;
}

export const EmbedCodeModal: React.FC<EmbedCodeModalProps> = ({
  isOpen,
  form,
  onClose,
}) => {
  const [copiedIframe, setCopiedIframe] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);
  const [embedWidth, setEmbedWidth] = useState('100%');
  const [embedHeight, setEmbedHeight] = useState('800');

  if (!form) return null;

  // Get the base URL (in production, this should be your actual domain)
  const baseUrl = window.location.origin;
  const embedUrl = `${baseUrl}/order/${form.slug}`;

  // Generate iframe embed code
  const iframeCode = `<iframe
  src="${embedUrl}"
  width="${embedWidth}"
  height="${embedHeight}"
  frameborder="0"
  style="border: none; max-width: 1200px; margin: 0 auto; display: block;"
  title="${form.name} Checkout"
  allowtransparency="true"
  scrolling="auto"
></iframe>`;

  // Generate JavaScript embed code (with auto-resize)
  const scriptCode = `<div id="checkout-form-${form.slug}"></div>
<script>
  (function() {
    var iframe = document.createElement('iframe');
    iframe.src = '${embedUrl}';
    iframe.style.width = '${embedWidth}';
    iframe.style.height = '${embedHeight}px';
    iframe.style.border = 'none';
    iframe.style.maxWidth = '1200px';
    iframe.style.margin = '0 auto';
    iframe.style.display = 'block';
    iframe.setAttribute('scrolling', 'auto');
    iframe.setAttribute('allowtransparency', 'true');

    // Auto-resize support
    window.addEventListener('message', function(e) {
      if (e.origin === '${baseUrl}' && e.data.type === 'checkout-resize') {
        iframe.style.height = e.data.height + 'px';
      }
    });

    document.getElementById('checkout-form-${form.slug}').appendChild(iframe);
  })();
</script>`;

  const copyToClipboard = async (text: string, type: 'iframe' | 'script') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'iframe') {
        setCopiedIframe(true);
        setTimeout(() => setCopiedIframe(false), 2000);
      } else {
        setCopiedScript(true);
        setTimeout(() => setCopiedScript(false), 2000);
      }
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Embed Checkout Form"
      maxWidth="4xl"
    >
      <div className="space-y-6">
        {/* Form Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-1">{form.name}</h3>
          <p className="text-sm text-blue-700">
            Embed this checkout form on your website, landing page, or blog
          </p>
        </div>

        {/* Embed URL */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            <Globe className="w-4 h-4 inline mr-1" />
            Embed URL
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={embedUrl}
              readOnly
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm font-mono"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copyToClipboard(embedUrl, 'iframe')}
            >
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Customization Options */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Width
            </label>
            <select
              value={embedWidth}
              onChange={(e) => setEmbedWidth(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="100%">100% (Responsive)</option>
              <option value="600px">600px (Fixed)</option>
              <option value="800px">800px (Fixed)</option>
              <option value="1000px">1000px (Fixed)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Height (px)
            </label>
            <input
              type="number"
              value={embedHeight}
              onChange={(e) => setEmbedHeight(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              min="400"
              max="2000"
              step="50"
            />
          </div>
        </div>

        {/* Method 1: Simple Iframe */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              <Code2 className="w-4 h-4 inline mr-1" />
              Method 1: Simple Iframe (Recommended)
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copyToClipboard(iframeCode, 'iframe')}
            >
              {copiedIframe ? (
                <>
                  <Check className="w-4 h-4 mr-1" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1" />
                  Copy Code
                </>
              )}
            </Button>
          </div>
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs font-mono">
            <code>{iframeCode}</code>
          </pre>
          <p className="text-xs text-gray-500 mt-2">
            Copy and paste this code into your website's HTML
          </p>
        </div>

        {/* Method 2: JavaScript with Auto-Resize */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-700">
              Method 2: JavaScript with Auto-Resize (Advanced)
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => copyToClipboard(scriptCode, 'script')}
            >
              {copiedScript ? (
                <>
                  <Check className="w-4 h-4 mr-1" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1" />
                  Copy Code
                </>
              )}
            </Button>
          </div>
          <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs font-mono max-h-48">
            <code>{scriptCode}</code>
          </pre>
          <p className="text-xs text-gray-500 mt-2">
            This method automatically adjusts the iframe height based on content
          </p>
        </div>

        {/* Platform-Specific Instructions */}
        <div className="border-t pt-4">
          <h4 className="font-semibold text-gray-900 mb-3">
            Platform-Specific Instructions
          </h4>
          <div className="space-y-3 text-sm">
            <details className="border rounded-lg p-3">
              <summary className="font-medium cursor-pointer">
                WordPress
              </summary>
              <div className="mt-2 text-gray-600 space-y-2">
                <p>1. Go to your page/post editor</p>
                <p>2. Click the '+' button to add a new block</p>
                <p>3. Search for "Custom HTML" or "HTML" block</p>
                <p>4. Paste the iframe code above</p>
                <p>5. Publish or update your page</p>
              </div>
            </details>
            <details className="border rounded-lg p-3">
              <summary className="font-medium cursor-pointer">Shopify</summary>
              <div className="mt-2 text-gray-600 space-y-2">
                <p>1. Go to Online Store → Pages</p>
                <p>2. Create or edit a page</p>
                <p>3. Click "Show HTML" button ({"<>"} icon)</p>
                <p>4. Paste the iframe code above</p>
                <p>5. Save your page</p>
              </div>
            </details>
            <details className="border rounded-lg p-3">
              <summary className="font-medium cursor-pointer">
                Custom Website
              </summary>
              <div className="mt-2 text-gray-600 space-y-2">
                <p>1. Open your HTML file or page template</p>
                <p>2. Paste the iframe code where you want the form to appear</p>
                <p>3. Save and deploy your changes</p>
                <p>
                  4. For auto-resize support, use Method 2 (JavaScript) instead
                </p>
              </div>
            </details>
          </div>
        </div>

        {/* Preview Link */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-900">Preview</p>
            <p className="text-sm text-gray-600">
              Test the form in a new tab before embedding
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => window.open(embedUrl, '_blank')}
          >
            Open Preview
          </Button>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
};
