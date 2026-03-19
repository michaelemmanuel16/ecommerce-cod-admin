import React from 'react';
import { Link2, Unlink, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../../ui/Button';

interface WhatsAppOAuthButtonProps {
  oauthEnabled: boolean;
  isConnected: boolean;
  verifiedName?: string;
  displayPhone?: string;
  tokenExpiry?: string;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting?: boolean;
  disconnecting?: boolean;
}

export const WhatsAppOAuthButton: React.FC<WhatsAppOAuthButtonProps> = ({
  oauthEnabled,
  isConnected,
  verifiedName,
  displayPhone,
  tokenExpiry,
  onConnect,
  onDisconnect,
  connecting = false,
  disconnecting = false,
}) => {
  if (!oauthEnabled) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-gray-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-700">OAuth Not Available</p>
            <p className="text-xs text-gray-500 mt-1">
              META_APP_ID and META_APP_SECRET must be configured on the server to enable OAuth.
              Use the Manual Setup tab instead.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isConnected) {
    const expiryDate = tokenExpiry ? new Date(tokenExpiry) : null;
    const daysRemaining = expiryDate
      ? Math.round((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

    return (
      <div className="space-y-4">
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">Connected via Meta OAuth</p>
              {verifiedName && (
                <p className="text-sm text-green-700 mt-1">
                  <strong>{verifiedName}</strong>
                  {displayPhone && ` (${displayPhone})`}
                </p>
              )}
              {daysRemaining !== null && (
                <p className="text-xs text-green-600 mt-1">
                  Token expires in {daysRemaining} days
                  {daysRemaining <= 7 && ' — auto-refresh scheduled'}
                </p>
              )}
            </div>
          </div>
        </div>

        <Button
          variant="secondary"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="text-red-600 hover:text-red-700"
        >
          {disconnecting ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Unlink className="w-4 h-4 mr-2" />
          )}
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Connect your WhatsApp Business account via Meta OAuth to automatically configure
        access tokens and phone numbers.
      </p>
      <Button
        variant="primary"
        onClick={onConnect}
        disabled={connecting}
      >
        {connecting ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Link2 className="w-4 h-4 mr-2" />
        )}
        {connecting ? 'Connecting...' : 'Connect with Meta'}
      </Button>
    </div>
  );
};
