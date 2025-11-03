import React from 'react';
import { CheckCircle } from 'lucide-react';
import { Button } from '../ui/Button';

interface OrderSuccessProps {
  orderId: number;
  onClose?: () => void;
}

export const OrderSuccess: React.FC<OrderSuccessProps> = ({ orderId, onClose }) => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg border border-gray-200 p-8 text-center">
        {/* Success Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-12 h-12 text-green-600" />
          </div>
        </div>

        {/* Success Message */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Order Placed Successfully!
        </h1>
        <p className="text-gray-600 mb-8">
          Thank you for your order. We've received it and will process it shortly.
        </p>

        {/* Order ID */}
        <div className="bg-gray-50 rounded-lg p-6 mb-8 border-2 border-gray-200">
          <p className="text-sm text-gray-600 mb-2">Your Order ID</p>
          <p className="text-2xl font-bold text-[#0f172a] font-mono">
            #{orderId}
          </p>
        </div>

        {/* Instructions */}
        <div className="text-left space-y-4 mb-8">
          <h2 className="font-semibold text-gray-900">What's Next?</h2>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start">
              <span className="inline-block w-1.5 h-1.5 bg-[#0f172a] rounded-full mt-1.5 mr-2 flex-shrink-0"></span>
              <span>Our team will confirm your order within 24 hours</span>
            </li>
            <li className="flex items-start">
              <span className="inline-block w-1.5 h-1.5 bg-[#0f172a] rounded-full mt-1.5 mr-2 flex-shrink-0"></span>
              <span>You'll receive SMS updates about your order status</span>
            </li>
            <li className="flex items-start">
              <span className="inline-block w-1.5 h-1.5 bg-[#0f172a] rounded-full mt-1.5 mr-2 flex-shrink-0"></span>
              <span>Save your order ID for tracking purposes</span>
            </li>
            <li className="flex items-start">
              <span className="inline-block w-1.5 h-1.5 bg-[#0f172a] rounded-full mt-1.5 mr-2 flex-shrink-0"></span>
              <span>Prepare exact cash for delivery (COD)</span>
            </li>
          </ul>
        </div>

        {/* Action Button */}
        {onClose && (
          <Button
            onClick={onClose}
            className="w-full bg-[#0f172a] hover:bg-[#1e293b] text-white font-semibold py-3"
          >
            Place Another Order
          </Button>
        )}

        {/* Contact Info */}
        <p className="text-xs text-gray-500 mt-6">
          Questions? Contact us for support
        </p>
      </div>
    </div>
  );
};
