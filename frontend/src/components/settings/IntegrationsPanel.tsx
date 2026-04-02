import React, { useState, useCallback } from 'react';
import { MessageSquare, Phone, Mail, Webhook, ChevronRight, CreditCard } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { SystemConfig } from '../../services/admin.service';
import { SmsIntegration } from './integrations/SmsIntegration';
import { WhatsAppIntegration } from './integrations/WhatsAppIntegration';
import { EmailIntegration } from './integrations/EmailIntegration';
import { PaystackIntegration } from './integrations/PaystackIntegration';
import { WebhooksOverview } from './integrations/WebhooksOverview';

type IntegrationSection = 'sms' | 'whatsapp' | 'email' | 'paystack' | 'webhooks';
const VALID_SECTIONS: IntegrationSection[] = ['sms', 'whatsapp', 'email', 'paystack', 'webhooks'];

const NAV_ITEMS: { id: IntegrationSection; label: string; description: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'sms', label: 'SMS', description: 'Arkesel SMS', icon: Phone },
  { id: 'whatsapp', label: 'WhatsApp', description: 'Business API', icon: MessageSquare },
  { id: 'email', label: 'Email', description: 'SendGrid / SMTP', icon: Mail },
  { id: 'paystack', label: 'Paystack', description: 'Online Payments', icon: CreditCard },
  { id: 'webhooks', label: 'Webhooks', description: 'Order imports', icon: Webhook },
];

interface IntegrationsPanelProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

export const IntegrationsPanel: React.FC<IntegrationsPanelProps> = ({ systemConfig, onConfigSaved }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section') as IntegrationSection;
  const initialSection = sectionParam && VALID_SECTIONS.includes(sectionParam) ? sectionParam : 'sms';
  const [activeSection, setActiveSectionState] = useState<IntegrationSection>(initialSection);

  const setActiveSection = (section: IntegrationSection) => {
    setActiveSectionState(section);
    const params = new URLSearchParams(searchParams);
    params.set('section', section);
    setSearchParams(params, { replace: true });
  };

  const getStatus = useCallback((section: IntegrationSection): 'configured' | 'not-configured' | null => {
    if (!systemConfig) return null;
    switch (section) {
      case 'sms':
        return systemConfig.smsProvider?.authToken ? 'configured' : 'not-configured';
      case 'whatsapp':
        return systemConfig.whatsappProvider?.accessToken ? 'configured' : 'not-configured';
      case 'email':
        return systemConfig.emailProvider?.apiKey ? 'configured' : 'not-configured';
      case 'paystack':
        return systemConfig.paystackProvider?.secretKey ? 'configured' : 'not-configured';
      default:
        return null;
    }
  }, [systemConfig]);

  const renderContent = () => {
    switch (activeSection) {
      case 'sms':
        return <SmsIntegration systemConfig={systemConfig} onConfigSaved={onConfigSaved} />;
      case 'whatsapp':
        return <WhatsAppIntegration systemConfig={systemConfig} onConfigSaved={onConfigSaved} />;
      case 'email':
        return <EmailIntegration systemConfig={systemConfig} onConfigSaved={onConfigSaved} />;
      case 'paystack':
        return <PaystackIntegration systemConfig={systemConfig} onConfigSaved={onConfigSaved} />;
      case 'webhooks':
        return <WebhooksOverview />;
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      {/* Sidebar — horizontal scroll on mobile, vertical card on desktop */}
      <div className="md:w-[240px] md:flex-shrink-0">
        <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-2 md:pb-0 md:bg-white md:rounded-xl md:border md:border-gray-200 md:p-2 md:shadow-sm">
          {NAV_ITEMS.map(({ id, label, description, icon: Icon }) => {
            const isActive = activeSection === id;
            const status = getStatus(id);
            return (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={`group flex items-center gap-3 px-3.5 py-3 rounded-lg text-left whitespace-nowrap md:whitespace-normal transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-50 ring-1 ring-blue-200 shadow-sm'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 transition-colors ${
                  isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200'
                }`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 hidden md:block">
                  <div className={`text-sm font-semibold leading-tight ${isActive ? 'text-blue-900' : 'text-gray-800'}`}>
                    {label}
                  </div>
                  <div className={`text-xs mt-0.5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                    {description}
                  </div>
                </div>
                {/* Mobile: just show label */}
                <span className={`md:hidden text-sm font-medium ${isActive ? 'text-blue-700' : 'text-gray-600'}`}>
                  {label}
                </span>
                {status && (
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 transition-colors ${
                    status === 'configured'
                      ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                      : 'bg-gray-300'
                  }`} />
                )}
                {isActive && (
                  <ChevronRight className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 hidden md:block" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {renderContent()}
      </div>
    </div>
  );
};
