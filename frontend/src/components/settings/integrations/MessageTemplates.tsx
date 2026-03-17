import React, { useState, useEffect } from 'react';
import { Save, ChevronDown, ChevronRight, Phone, Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { adminService, SystemConfig } from '../../../services/admin.service';

interface MessageTemplatesProps {
  systemConfig: SystemConfig | null;
  onConfigSaved: () => void;
}

interface TemplateGroup {
  sms: string;
  email: string;
}

const TEMPLATE_TYPES = [
  { key: 'orderConfirmation', label: 'Order Confirmation', description: 'Sent when an order is placed' },
  { key: 'outForDelivery', label: 'Out for Delivery', description: 'Sent when delivery begins' },
  { key: 'delivered', label: 'Delivered', description: 'Sent upon successful delivery' },
  { key: 'paymentReminder', label: 'Payment Reminder', description: 'Sent for pending COD payments' },
] as const;

type TemplateKey = typeof TEMPLATE_TYPES[number]['key'];

const DEFAULT_TEMPLATES: Record<TemplateKey, TemplateGroup> = {
  orderConfirmation: { sms: '', email: '' },
  outForDelivery: { sms: '', email: '' },
  delivered: { sms: '', email: '' },
  paymentReminder: { sms: '', email: '' },
};

export const MessageTemplates: React.FC<MessageTemplatesProps> = ({ systemConfig, onConfigSaved }) => {
  const [templates, setTemplates] = useState<Record<TemplateKey, TemplateGroup>>(DEFAULT_TEMPLATES);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['orderConfirmation']));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (systemConfig?.notificationTemplates) {
      const t = systemConfig.notificationTemplates;
      setTemplates({
        orderConfirmation: { sms: t.orderConfirmation?.sms || '', email: t.orderConfirmation?.email || '' },
        outForDelivery: { sms: t.outForDelivery?.sms || '', email: t.outForDelivery?.email || '' },
        delivered: { sms: t.delivered?.sms || '', email: t.delivered?.email || '' },
        paymentReminder: { sms: t.paymentReminder?.sms || '', email: t.paymentReminder?.email || '' },
      });
    }
  }, [systemConfig]);

  const toggleSection = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateTemplate = (key: TemplateKey, channel: 'sms' | 'email', value: string) => {
    setTemplates(prev => ({
      ...prev,
      [key]: { ...prev[key], [channel]: value },
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await adminService.updateSystemConfig({ notificationTemplates: templates });
      toast.success('Templates saved');
      onConfigSaved();
    } catch {
      toast.error('Failed to save templates');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <form onSubmit={handleSave}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Message Templates</h3>
          <div className="flex flex-wrap gap-2 mb-5">
            <span className="text-xs text-gray-500 leading-6">Variables:</span>
            {['{customerName}', '{orderNumber}', '{totalAmount}'].map(v => (
              <code key={v} className="inline-flex items-center px-2.5 py-1 rounded-md bg-gray-50 border border-gray-200 text-xs font-mono text-gray-700 select-all">
                {v}
              </code>
            ))}
          </div>

          <div className="space-y-3">
            {TEMPLATE_TYPES.map(({ key, label, description }) => {
              const isExpanded = expanded.has(key);
              const hasContent = templates[key].sms || templates[key].email;
              return (
                <div key={key} className={`border rounded-xl transition-colors ${isExpanded ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
                  <button
                    type="button"
                    onClick={() => toggleSection(key)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors rounded-xl"
                  >
                    <div className={`flex items-center justify-center w-6 h-6 rounded-md transition-colors ${isExpanded ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      {isExpanded ? (
                        <ChevronDown className={`w-3.5 h-3.5 ${isExpanded ? 'text-blue-600' : 'text-gray-500'}`} />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <span className={`font-medium text-sm ${isExpanded ? 'text-blue-900' : 'text-gray-900'}`}>{label}</span>
                      <span className="text-xs text-gray-400 ml-2">{description}</span>
                    </div>
                    {hasContent && !isExpanded && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        Configured
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-4">
                      <div>
                        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                          <Phone className="w-3.5 h-3.5 text-gray-400" />
                          SMS Template
                        </label>
                        <textarea
                          rows={2}
                          value={templates[key].sms}
                          onChange={(e) => updateTemplate(key, 'sms', e.target.value)}
                          placeholder={`Hi {customerName}, your order {orderNumber}...`}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                          <Mail className="w-3.5 h-3.5 text-gray-400" />
                          Email Template
                        </label>
                        <textarea
                          rows={4}
                          value={templates[key].email}
                          onChange={(e) => updateTemplate(key, 'email', e.target.value)}
                          placeholder={`Dear {customerName},\n\nYour order {orderNumber}...`}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex justify-end">
            <Button variant="primary" type="submit" disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Templates'}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
};
