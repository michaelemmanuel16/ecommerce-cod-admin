import React, { useState } from 'react';
import { Copy, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { Webhook } from '../../types';
import { Button } from '../ui/Button';

interface WebhookIntegrationDetailsProps {
  webhook: Webhook;
  compact?: boolean;
}

const getApiBaseUrl = (): string => {
  // Check for environment variable first
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  // Fallback to current origin
  return window.location.origin;
};

export const WebhookIntegrationDetails: React.FC<WebhookIntegrationDetailsProps> = ({
  webhook,
  compact = false
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedApiKey, setCopiedApiKey] = useState(false);

  const webhookUrl = `${getApiBaseUrl()}/api/webhooks/import`;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  };

  const handleCopyApiKey = async () => {
    try {
      await navigator.clipboard.writeText(webhook.apiKey || '');
      setCopiedApiKey(true);
      setTimeout(() => setCopiedApiKey(false), 2000);
    } catch (error) {
      console.error('Failed to copy API key:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Endpoint URL */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Webhook Endpoint
        </label>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-gray-100 px-3 py-2 rounded border border-gray-300 text-sm font-mono">
            POST {webhookUrl}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyUrl}
            className="flex-shrink-0"
          >
            {copiedUrl ? (
              <CheckCircle className="w-4 h-4 text-green-600" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* API Key */}
      {webhook.apiKey && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            API Key
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-gray-100 px-3 py-2 rounded border border-gray-300 text-sm font-mono">
              {showApiKey ? webhook.apiKey : '••••••••••••••••••••••••••••••••'}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowApiKey(!showApiKey)}
              className="flex-shrink-0"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyApiKey}
              className="flex-shrink-0"
            >
              {copiedApiKey ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Curl Example */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Example Request
        </label>
        <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs font-mono">
{`curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${webhook.apiKey || 'your-api-key-here'}" \\
  -d '{
    "customer_phone": "0241234567",
    "customer_name": "John Doe",
    "product_name": "Magic Copybook",
    "quantity": 1,
    "price": 250,
    "address": "123 Main St, Accra"
  }'`}
        </pre>
      </div>
    </div>
  );
};
