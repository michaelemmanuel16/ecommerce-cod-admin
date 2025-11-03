import React, { useState, useMemo } from 'react';
import {
  X,
  Search,
  Zap,
  Clock,
  Webhook,
  UserCheck,
  Mail,
  MessageSquare,
  ShoppingCart,
  Package,
  TrendingUp,
  MapPin,
  Tag,
  ArrowRight,
  Eye,
  Check,
} from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Input';
import { cn } from '../../utils/cn';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: {
    type: 'webhook' | 'status_change' | 'time_based' | 'manual';
    label: string;
    config?: any;
  };
  conditions?: Array<{
    field: string;
    operator: string;
    value: any;
  }>;
  actions: Array<{
    type: string;
    description: string;
    config?: any;
  }>;
  icon?: string;
  tags?: string[];
}

interface WorkflowTemplateGalleryProps {
  onSelectTemplate: (template: WorkflowTemplate) => void;
  onClose?: () => void;
}

// Template data
const templateData: WorkflowTemplate[] = [
  {
    id: 'auto-confirm-sms',
    name: 'Send Confirmation SMS',
    description: 'Automatically send SMS to customer when order is confirmed',
    category: 'Communications',
    trigger: {
      type: 'status_change',
      label: 'Order Status Changes to Confirmed',
      config: { fromStatus: 'pending_confirmation', toStatus: 'confirmed' },
    },
    actions: [
      {
        type: 'send_sms',
        description: 'Send confirmation message to customer',
        config: {
          message: 'Your order {{orderNumber}} has been confirmed! We will notify you when it ships.',
        },
      },
    ],
    icon: 'message',
    tags: ['sms', 'notification', 'customer'],
  },
  {
    id: 'assign-by-product',
    name: 'Assign Orders by Product',
    description: 'Auto-assign delivery agent based on product type or category',
    category: 'Order Management',
    trigger: {
      type: 'status_change',
      label: 'Order Status Changes to Ready for Pickup',
      config: { toStatus: 'ready_for_pickup' },
    },
    conditions: [
      {
        field: 'product.category',
        operator: 'equals',
        value: 'Electronics',
      },
    ],
    actions: [
      {
        type: 'assign_agent',
        description: 'Assign to specialized electronics delivery team',
        config: { agentRole: 'electronics_specialist' },
      },
      {
        type: 'send_email',
        description: 'Notify assigned agent',
        config: {
          template: 'agent_assignment',
          subject: 'New Electronics Order Assigned',
        },
      },
    ],
    icon: 'package',
    tags: ['assignment', 'automation', 'delivery'],
  },
  {
    id: 'high-value-alert',
    name: 'High-Value Order Alert',
    description: 'Send alert to manager when order exceeds threshold',
    category: 'Customer Service',
    trigger: {
      type: 'status_change',
      label: 'Order Status Changes to Confirmed',
      config: { toStatus: 'confirmed' },
    },
    conditions: [
      {
        field: 'totalAmount',
        operator: 'greater_than',
        value: 10000,
      },
    ],
    actions: [
      {
        type: 'send_email',
        description: 'Email manager about high-value order',
        config: {
          template: 'high_value_alert',
          subject: 'High Value Order Alert - {{orderNumber}}',
        },
      },
      {
        type: 'add_tag',
        description: 'Tag order as high-value',
        config: { tag: 'high-value' },
      },
    ],
    icon: 'trending',
    tags: ['alert', 'high-value', 'notification'],
  },
  {
    id: 'auto-assign-area',
    name: 'Auto-Assign by Area',
    description: 'Automatically assign delivery agent based on delivery location',
    category: 'Operations',
    trigger: {
      type: 'status_change',
      label: 'Order Status Changes to Ready for Pickup',
      config: { toStatus: 'ready_for_pickup' },
    },
    actions: [
      {
        type: 'assign_agent',
        description: 'Find nearest available agent in delivery area',
        config: { strategy: 'nearest_by_location' },
      },
      {
        type: 'send_sms',
        description: 'Notify agent of new assignment',
        config: {
          message: 'New order assigned: {{orderNumber}} - {{customerAddress}}',
        },
      },
    ],
    icon: 'map',
    tags: ['assignment', 'location', 'automation'],
  },
  {
    id: 'vip-priority',
    name: 'VIP Customer Priority',
    description: 'Flag VIP customers and prioritize their orders',
    category: 'Customer Service',
    trigger: {
      type: 'status_change',
      label: 'New Order Created',
      config: { toStatus: 'pending_confirmation' },
    },
    conditions: [
      {
        field: 'customer.totalOrders',
        operator: 'greater_than',
        value: 10,
      },
    ],
    actions: [
      {
        type: 'update_order',
        description: 'Set priority to high',
        config: { priority: 'high' },
      },
      {
        type: 'add_tag',
        description: 'Add VIP tag',
        config: { tag: 'vip-customer' },
      },
      {
        type: 'send_email',
        description: 'Send personalized confirmation',
        config: {
          template: 'vip_confirmation',
          subject: 'Thank you for your continued business!',
        },
      },
    ],
    icon: 'user',
    tags: ['vip', 'priority', 'customer'],
  },
  {
    id: 'delivery-reminder',
    name: 'Daily Delivery Reminder',
    description: 'Send daily reminder for pending deliveries',
    category: 'Operations',
    trigger: {
      type: 'time_based',
      label: 'Every day at 9:00 AM',
      config: { cronExpression: '0 9 * * *' },
    },
    actions: [
      {
        type: 'send_email',
        description: 'Email delivery agents their daily schedule',
        config: {
          template: 'daily_delivery_schedule',
          subject: 'Your Delivery Schedule - {{date}}',
        },
      },
    ],
    icon: 'clock',
    tags: ['scheduled', 'reminder', 'delivery'],
  },
  {
    id: 'webhook-shopify',
    name: 'Shopify Order Import',
    description: 'Import orders from Shopify via webhook',
    category: 'Integrations',
    trigger: {
      type: 'webhook',
      label: 'Shopify Webhook',
      config: { webhookPath: '/shopify-orders' },
    },
    actions: [
      {
        type: 'http_request',
        description: 'Transform and validate order data',
        config: { method: 'POST' },
      },
      {
        type: 'send_email',
        description: 'Notify staff of new import',
        config: {
          template: 'order_imported',
          subject: 'New Order Imported from Shopify',
        },
      },
    ],
    icon: 'webhook',
    tags: ['webhook', 'shopify', 'integration'],
  },
  {
    id: 'failed-delivery-followup',
    name: 'Failed Delivery Follow-up',
    description: 'Automatically reschedule and notify customer after failed delivery',
    category: 'Order Management',
    trigger: {
      type: 'status_change',
      label: 'Order Status Changes to Failed Delivery',
      config: { toStatus: 'failed_delivery' },
    },
    actions: [
      {
        type: 'send_sms',
        description: 'Send SMS to customer for rescheduling',
        config: {
          message:
            'We missed you! Reply with a convenient time to reschedule delivery for order {{orderNumber}}.',
        },
      },
      {
        type: 'wait',
        description: 'Wait 2 hours for response',
        config: { duration: 120 },
      },
      {
        type: 'send_email',
        description: 'Send follow-up email with rescheduling link',
        config: {
          template: 'reschedule_delivery',
          subject: 'Reschedule Your Delivery',
        },
      },
    ],
    icon: 'package',
    tags: ['failed', 'followup', 'customer-service'],
  },
];

const categories = [
  'All',
  'Order Management',
  'Customer Service',
  'Communications',
  'Operations',
  'Integrations',
];

const getTriggerIcon = (type: string) => {
  switch (type) {
    case 'webhook':
      return Webhook;
    case 'status_change':
      return ShoppingCart;
    case 'time_based':
      return Clock;
    case 'manual':
      return UserCheck;
    default:
      return Zap;
  }
};

const getCategoryIcon = (category: string) => {
  switch (category) {
    case 'Communications':
      return MessageSquare;
    case 'Order Management':
      return ShoppingCart;
    case 'Customer Service':
      return UserCheck;
    case 'Operations':
      return Package;
    case 'Integrations':
      return Webhook;
    default:
      return Tag;
  }
};

const getTemplateIcon = (icon: string) => {
  switch (icon) {
    case 'message':
      return MessageSquare;
    case 'package':
      return Package;
    case 'trending':
      return TrendingUp;
    case 'map':
      return MapPin;
    case 'user':
      return UserCheck;
    case 'clock':
      return Clock;
    case 'webhook':
      return Webhook;
    default:
      return Zap;
  }
};

export const WorkflowTemplateGallery: React.FC<WorkflowTemplateGalleryProps> = ({
  onSelectTemplate,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [previewTemplate, setPreviewTemplate] = useState<WorkflowTemplate | null>(null);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templateData.filter((template) => {
      const matchesSearch =
        searchQuery === '' ||
        template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.tags?.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCategory =
        selectedCategory === 'All' || template.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Workflow Templates</h2>
            <p className="text-sm text-gray-500 mt-1">
              Choose a pre-built template to get started quickly
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Search and Filters */}
        <div className="px-6 py-4 border-b border-gray-200 space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search templates by name, description, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Category Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setSelectedCategory(category)}
                className={cn(
                  'px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors',
                  selectedCategory === category
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        {/* Templates Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Search className="w-12 h-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No templates found</p>
              <p className="text-sm">Try adjusting your search or filter criteria</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((template) => {
                const TemplateIcon = getTemplateIcon(template.icon || 'zap');
                const TriggerIcon = getTriggerIcon(template.trigger.type);
                const CategoryIcon = getCategoryIcon(template.category);

                return (
                  <Card
                    key={template.id}
                    className="hover:shadow-lg transition-shadow cursor-pointer flex flex-col"
                    padding="none"
                  >
                    {/* Card Header */}
                    <div className="p-4 border-b border-gray-100">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-blue-50 rounded-lg">
                          <TemplateIcon className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 mb-1 truncate">
                            {template.name}
                          </h3>
                          <Badge variant="default" className="bg-purple-100 text-purple-800">
                            <CategoryIcon className="w-3 h-3 mr-1" />
                            {template.category}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {template.description}
                      </p>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 flex-1 space-y-3">
                      {/* Trigger Info */}
                      <div className="flex items-start gap-2">
                        <div className="p-1.5 bg-green-50 rounded mt-0.5">
                          <TriggerIcon className="w-4 h-4 text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-500 uppercase">Trigger</p>
                          <p className="text-sm text-gray-900 truncate">
                            {template.trigger.label}
                          </p>
                        </div>
                      </div>

                      {/* Actions Count */}
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-orange-50 rounded">
                          <Zap className="w-4 h-4 text-orange-600" />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-medium text-gray-500 uppercase">Actions</p>
                          <p className="text-sm text-gray-900">
                            {template.actions.length} step{template.actions.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>

                      {/* Tags */}
                      {template.tags && template.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {template.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Card Footer */}
                    <div className="p-4 border-t border-gray-100 flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewTemplate(template)}
                        className="flex-1"
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        Preview
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onSelectTemplate(template)}
                        className="flex-1"
                      >
                        Use Template
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-600 text-center">
            Showing {filteredTemplates.length} of {templateData.length} templates
          </p>
        </div>
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            {/* Preview Header */}
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-start gap-3">
                <div className="p-3 bg-blue-50 rounded-lg">
                  {React.createElement(getTemplateIcon(previewTemplate.icon || 'zap'), {
                    className: 'w-6 h-6 text-blue-600',
                  })}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{previewTemplate.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">{previewTemplate.description}</p>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="default" className="bg-purple-100 text-purple-800">
                      {previewTemplate.category}
                    </Badge>
                    {previewTemplate.tags?.map((tag) => (
                      <Badge key={tag} variant="default" className="bg-gray-100 text-gray-600">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Workflow Steps */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-900">Workflow Steps</h4>

              {/* Trigger */}
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="p-2 bg-green-100 rounded-lg">
                    {React.createElement(getTriggerIcon(previewTemplate.trigger.type), {
                      className: 'w-5 h-5 text-green-600',
                    })}
                  </div>
                  <div className="w-0.5 h-8 bg-gray-300 my-2" />
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-green-600 uppercase">
                      Trigger
                    </span>
                    <Badge variant="default" className="bg-green-50 text-green-700 text-xs">
                      {previewTemplate.trigger.type.replace('_', ' ')}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {previewTemplate.trigger.label}
                  </p>
                </div>
              </div>

              {/* Conditions */}
              {previewTemplate.conditions && previewTemplate.conditions.length > 0 && (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="p-2 bg-yellow-100 rounded-lg">
                      <Check className="w-5 h-5 text-yellow-600" />
                    </div>
                    <div className="w-0.5 h-8 bg-gray-300 my-2" />
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-yellow-600 uppercase">
                        Conditions
                      </span>
                    </div>
                    <div className="space-y-1">
                      {previewTemplate.conditions.map((condition, idx) => (
                        <p key={idx} className="text-sm text-gray-700">
                          {condition.field} {condition.operator} {condition.value}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              {previewTemplate.actions.map((action, index) => (
                <div key={index} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Zap className="w-5 h-5 text-blue-600" />
                    </div>
                    {index < previewTemplate.actions.length - 1 && (
                      <div className="w-0.5 h-8 bg-gray-300 my-2" />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-blue-600 uppercase">
                        Action {index + 1}
                      </span>
                      <Badge variant="default" className="bg-blue-50 text-blue-700 text-xs">
                        {action.type.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{action.description}</p>
                    {action.config && Object.keys(action.config).length > 0 && (
                      <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
                        {Object.entries(action.config)
                          .slice(0, 2)
                          .map(([key, value]) => (
                            <div key={key}>
                              <span className="font-medium">{key}:</span> {String(value)}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Preview Footer */}
            <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
              <Button
                variant="ghost"
                onClick={() => setPreviewTemplate(null)}
                className="flex-1"
              >
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  onSelectTemplate(previewTemplate);
                  setPreviewTemplate(null);
                }}
                className="flex-1"
              >
                Use This Template
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
