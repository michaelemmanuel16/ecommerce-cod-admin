import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Webhook, ArrowRight } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';

export const WebhooksOverview: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Webhooks</h3>
            <p className="text-sm text-gray-500 mt-1">
              Import orders automatically from external systems via webhooks
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/webhooks')}>
            <Webhook className="w-4 h-4 mr-2" />
            Manage Webhooks
          </Button>
        </div>

        <div className="border border-gray-200 rounded-xl p-5 bg-gradient-to-br from-blue-50/60 to-white">
          <h4 className="font-semibold text-gray-900 mb-3 text-sm">Quick Start</h4>
          <ol className="text-sm text-gray-600 space-y-2.5">
            {[
              'Open the Webhooks page to create a new endpoint',
              'Configure name, URL, and HMAC secret key',
              'Map external field names to internal order fields',
              'Test your field mapping with sample payload data',
              'Activate the webhook to start importing orders',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-4 pt-4 border-t border-blue-100">
            <button
              onClick={() => navigate('/webhooks')}
              className="group inline-flex items-center text-sm font-medium text-blue-700 hover:text-blue-800 transition-colors"
            >
              Go to Webhooks
              <ArrowRight className="w-3.5 h-3.5 ml-1.5 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
};
