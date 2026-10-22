import React from 'react';
import { FileText } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

/** The old Checkout Forms card, moved out of pages/Settings.tsx unchanged (M3-T63). Its new home is the Checkout forms page in the menu. */
export const LegacyCheckoutFormsPanel: React.FC = () => (
  <Card>
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Checkout Forms</h3>
          <p className="text-sm text-gray-600 mt-1">
            Create and manage custom checkout forms for your products
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => window.location.href = '/checkout-forms'}
        >
          <FileText className="w-4 h-4 mr-2" />
          Manage Forms
        </Button>
      </div>
      <div className="space-y-4">
        <div className="border border-gray-200 rounded-lg p-4 bg-blue-50">
          <h4 className="font-medium text-gray-900 mb-2">🚀 Quick Start</h4>
          <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
            <li>Click "Manage Forms" to open the Checkout Forms page</li>
            <li>Click "+ Create Checkout Form" button</li>
            <li>Select a product and configure pricing packages</li>
            <li>Add optional upsells for extra revenue</li>
            <li>Customize colors to match your brand</li>
            <li>Share the public URL with customers!</li>
          </ol>
        </div>
      </div>
    </div>
  </Card>
);
