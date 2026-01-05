import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Tabs } from '../ui/Tabs';
import { FormCheckbox } from './FormCheckbox';
import { WebhookIntegrationDetails } from '../webhook/WebhookIntegrationDetails';
import { Webhook, WebhookFormData, Product } from '../../types';
import { webhooksService } from '../../services/webhooks.service';
import { productsService } from '../../services/products.service';
import {
  validateSecret,
  generateSecret,
} from '../../utils/webhookValidation';

interface WebhookFormProps {
  isOpen: boolean;
  onClose: () => void;
  webhook?: Webhook | null;
  onSuccess?: () => void;
}

export const WebhookForm: React.FC<WebhookFormProps> = ({
  isOpen,
  onClose,
  webhook,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTestingMapping, setIsTestingMapping] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showIntegration, setShowIntegration] = useState(false);
  const [savedWebhook, setSavedWebhook] = useState<Webhook | null>(null);

  // Product selection
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    url: '', // External system URL (not our receiving URL)
    secret: '',
    productId: 0,
    isActive: true,
  });

  // Fixed field mapping for WPForms structure
  const [fieldMapping, setFieldMapping] = useState({
    customerName: 'customer_name',
    phoneNumber: 'phone_number',
    alternativePhone: 'alternative_phone_number',
    customerAddress: 'customer_address',
    region: 'region',
    quantity: 'quantity', // Contains package + price info
  });

  const [headers, setHeaders] = useState<Array<{ key: string; value: string }>>([]);

  const [sampleData, setSampleData] = useState('{\n  "customer_name": "John Doe",\n  "phone_number": "1234567890",\n  "alternative_phone_number": "0987654321",\n  "customer_address": "123 Main Street",\n  "region": "Accra",\n  "quantity": "BUY TWO SETS - GH₵450"\n}');

  const [errors, setErrors] = useState({
    name: '',
    url: '',
    secret: '',
    productId: '',
    fieldMapping: '',
  });

  // Fetch products on mount
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        setLoadingProducts(true);
        const productsList = await productsService.getProducts();
        setProducts(productsList);
      } catch (error) {
        console.error('Failed to fetch products:', error);
        toast.error('Failed to load products');
      } finally {
        setLoadingProducts(false);
      }
    };

    if (isOpen) {
      fetchProducts();
    }
  }, [isOpen]);

  useEffect(() => {
    // Reset integration view when modal opens/closes
    setShowIntegration(false);
    setSavedWebhook(null);

    if (webhook) {
      setFormData({
        name: webhook.name || '',
        url: webhook.url || '',
        secret: webhook.secret || '',
        productId: webhook.productId || 0,
        isActive: webhook.isActive !== undefined ? webhook.isActive : true,
      });

      // Convert API field mapping to fixed format
      const mapping = webhook.fieldMapping || {};
      setFieldMapping({
        customerName: mapping.customerFirstName || mapping.customerName || 'customer_name',
        phoneNumber: mapping.customerPhone || 'phone_number',
        alternativePhone: mapping.alternativePhone || 'alternative_phone_number',
        customerAddress: mapping.deliveryAddress || 'customer_address',
        region: mapping.deliveryState || mapping.region || 'region',
        quantity: mapping.quantity || mapping.package || 'quantity',
      });

      // Convert headers object to array
      if (webhook.headers) {
        setHeaders(
          Object.entries(webhook.headers).map(([key, value]) => ({ key, value: String(value) }))
        );
      } else {
        setHeaders([]);
      }
    } else {
      // Reset form for new webhook
      setFormData({
        name: '',
        url: '',
        secret: '',
        productId: 0,
        isActive: true,
      });
      setFieldMapping({
        customerName: 'customer_name',
        phoneNumber: 'phone_number',
        alternativePhone: 'alternative_phone_number',
        customerAddress: 'customer_address',
        region: 'region',
        quantity: 'quantity',
      });
      setHeaders([]);
      setSampleData('{\n  "customer_name": "John Doe",\n  "phone_number": "1234567890",\n  "alternative_phone_number": "0987654321",\n  "customer_address": "123 Main Street",\n  "region": "Accra",\n  "quantity": "BUY TWO SETS - GH₵450"\n}');
      setTestResult(null);
    }
    setErrors({ name: '', secret: '', productId: '', fieldMapping: '' });
  }, [webhook, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error for this field
    setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, isActive: e.target.checked }));
  };

  const handleGenerateSecret = () => {
    setFormData((prev) => ({ ...prev, secret: generateSecret() }));
    setErrors((prev) => ({ ...prev, secret: '' }));
  };

  const handleFieldMappingChange = (field: keyof typeof fieldMapping, value: string) => {
    setFieldMapping((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, fieldMapping: '' }));
  };

  const handleAddHeader = () => {
    setHeaders([...headers, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const handleUpdateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...headers];
    updated[index][field] = value;
    setHeaders(updated);
  };

  const handleTestMapping = async () => {
    if (!webhook) {
      alert('Please save the webhook first before testing.');
      return;
    }

    try {
      setIsTestingMapping(true);
      setTestResult(null);
      const parsedSampleData = JSON.parse(sampleData);
      const result = await webhooksService.testWebhook(webhook.id, parsedSampleData);
      setTestResult(JSON.stringify(result, null, 2));
    } catch (error: any) {
      console.error('Error testing webhook:', error);
      setTestResult(`Error: ${error.message || 'Failed to test webhook mapping'}`);
    } finally {
      setIsTestingMapping(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors = {
      name: '',
      secret: '',
      productId: '',
      fieldMapping: '',
    };

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    // Only validate secret if user provided one
    if (formData.secret.trim()) {
      const secretError = validateSecret(formData.secret);
      if (secretError) {
        newErrors.secret = secretError;
      }
    }

    if (!formData.productId || formData.productId === 0) {
      newErrors.productId = 'Please select a product';
    }

    // Validate field mappings are not empty
    if (!fieldMapping.customerName.trim() || !fieldMapping.phoneNumber.trim() ||
        !fieldMapping.alternativePhone.trim() || !fieldMapping.customerAddress.trim() ||
        !fieldMapping.region.trim() || !fieldMapping.quantity.trim()) {
      newErrors.fieldMapping = 'All field names are required';
    }

    setErrors(newErrors);
    return !Object.values(newErrors).some((error) => error !== '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      // Show which fields have errors
      const errorMessages = [];
      if (errors.name) errorMessages.push('Webhook Name');
      if (errors.secret) errorMessages.push('Secret Key');
      if (errors.productId) errorMessages.push('Product');
      if (errors.fieldMapping) errorMessages.push('Field Mappings');

      toast.error(`Please fix: ${errorMessages.join(', ')}`);
      return;
    }

    setIsSubmitting(true);

    try {
      // Convert field mapping to API format
      const apiFieldMapping = {
        customerFirstName: fieldMapping.customerName,
        customerPhone: fieldMapping.phoneNumber,
        alternativePhone: fieldMapping.alternativePhone,
        deliveryAddress: fieldMapping.customerAddress,
        deliveryState: fieldMapping.region,
        quantity: fieldMapping.quantity,
      };

      // Convert headers array to object
      const headersObject = headers.reduce((acc, h) => {
        if (h.key && h.value) {
          acc[h.key] = h.value;
        }
        return acc;
      }, {} as Record<string, string>);

      const webhookData: WebhookFormData = {
        name: formData.name.trim(),
        url: '', // External system URL removed from form, sending empty string
        secret: formData.secret,
        productId: Number(formData.productId),
        isActive: formData.isActive,
        fieldMapping: apiFieldMapping,
        headers: Object.keys(headersObject).length > 0 ? headersObject : undefined,
      };

      let result: Webhook;
      if (webhook) {
        result = await webhooksService.updateWebhook(webhook.id, webhookData);
        toast.success(`Webhook "${webhookData.name}" updated successfully`);
      } else {
        result = await webhooksService.createWebhook(webhookData);
        toast.success(`Webhook "${webhookData.name}" created successfully`);
      }

      // Show integration details instead of immediately closing
      setSavedWebhook(result);
      setShowIntegration(true);

      // Don't call onClose() yet - let user view integration details
    } catch (error: any) {
      console.error('Error saving webhook:', error);
      toast.error(error.response?.data?.message || 'Failed to save webhook');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDone = () => {
    onSuccess?.();
    onClose();
  };

  const tabs = [
    {
      id: 'configuration',
      label: 'Configuration',
      content: (
        <div className="space-y-6">
          {/* Product Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Product Name (Display Name) <span className="text-red-500">*</span>
            </label>
            <select
              name="productId"
              value={formData.productId}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loadingProducts}
            >
              <option value={0}>Select a product...</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} {product.sku ? `(${product.sku})` : ''}
                </option>
              ))}
            </select>
            {errors.productId && (
              <p className="mt-1 text-sm text-red-600">{errors.productId}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              This product will be used for all orders imported via this webhook
            </p>
          </div>

          {/* Webhook Name */}
          <Input
            label="Webhook Name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            placeholder="e.g., WPForms - Magic Copybook"
            error={errors.name}
          />

          {/* Webhook Receiving URL (Auto-generated, read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Webhook URL (Receiving)
            </label>
            <div className="flex gap-2">
              <Input
                value={webhook ? `${window.location.origin}/api/webhooks/import/${webhook.uniqueUrl}` : 'Auto-generated after saving'}
                readOnly
                className="flex-1 bg-gray-50"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              This unique URL will receive webhook requests from your external system
            </p>
          </div>

          {/* Field Mappings */}
          <div className="border-t pt-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              Field Mappings (Based on Your Request Body Structure)
            </h3>

            {errors.fieldMapping && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{errors.fieldMapping}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer Name Field
                </label>
                <Input
                  value={fieldMapping.customerName}
                  onChange={(e) => handleFieldMappingChange('customerName', e.target.value)}
                  placeholder="customer_name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number Field
                </label>
                <Input
                  value={fieldMapping.phoneNumber}
                  onChange={(e) => handleFieldMappingChange('phoneNumber', e.target.value)}
                  placeholder="phone_number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Alternative Phone Field
                </label>
                <Input
                  value={fieldMapping.alternativePhone}
                  onChange={(e) => handleFieldMappingChange('alternativePhone', e.target.value)}
                  placeholder="alternative_phone_number"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer Address Field
                </label>
                <Input
                  value={fieldMapping.customerAddress}
                  onChange={(e) => handleFieldMappingChange('customerAddress', e.target.value)}
                  placeholder="customer_address"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Region Field
                </label>
                <Input
                  value={fieldMapping.region}
                  onChange={(e) => handleFieldMappingChange('region', e.target.value)}
                  placeholder="region"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quantity Field (Contains Product + Price)
                </label>
                <Input
                  value={fieldMapping.quantity}
                  onChange={(e) => handleFieldMappingChange('quantity', e.target.value)}
                  placeholder="quantity"
                />
              </div>
            </div>

            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900 font-medium mb-2">
                📦 Package Field Parsing
              </p>
              <p className="text-xs text-blue-800">
                The <strong>Quantity field</strong> will be automatically parsed to extract:
              </p>
              <ul className="mt-2 text-xs text-blue-800 list-disc list-inside space-y-1">
                <li><strong>Quantity:</strong> Number of items (e.g., "TWO" → 2)</li>
                <li><strong>Price:</strong> Unit price (e.g., "GH₵450" → 450)</li>
              </ul>
              <p className="mt-2 text-xs text-blue-700">
                Supported formats: "BUY TWO SETS - GH₵450", "BUY TWO: GHC450", "BUY 2 GET 2 (4PCS): GHC450"
              </p>
            </div>
          </div>

          <FormCheckbox
            label="Active"
            checked={formData.isActive}
            onChange={handleCheckboxChange}
            helperText="Webhook will process incoming requests when active"
          />
        </div>
      ),
    },
    {
      id: 'security',
      label: 'Security',
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Secret Key (Optional)
            </label>
            <div className="flex gap-2">
              <Input
                name="secret"
                value={formData.secret}
                onChange={handleChange}
                placeholder="Min. 16 characters"
                error={errors.secret}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleGenerateSecret}
              >
                Generate
              </Button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Used to sign webhook requests for verification (HMAC SHA256)
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Custom Headers (Optional)
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddHeader}
              >
                Add Header
              </Button>
            </div>

            {headers.length === 0 ? (
              <div className="text-center py-6 border-2 border-dashed border-gray-300 rounded-lg">
                <p className="text-sm text-gray-500">
                  No custom headers. Click "Add Header" to add one.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {headers.map((header, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <Input
                      placeholder="Header name (e.g., Authorization)"
                      value={header.key}
                      onChange={(e) => handleUpdateHeader(index, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Header value"
                      value={header.value}
                      onChange={(e) => handleUpdateHeader(index, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleRemoveHeader(index)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ),
    },
  ];

  // Only show Test tab when editing existing webhook
  if (webhook) {
    tabs.push({
      id: 'test',
      label: 'Test',
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sample JSON Payload
            </label>
            <textarea
              value={sampleData}
              onChange={(e) => setSampleData(e.target.value)}
              rows={12}
              placeholder={sampleData}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Enter a sample JSON payload to test your field mapping
            </p>
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={handleTestMapping}
            disabled={isTestingMapping}
          >
            {isTestingMapping ? 'Testing...' : 'Test Mapping'}
          </Button>

          {testResult && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Test Result
              </label>
              <pre className="max-h-96 overflow-auto bg-gray-50 p-4 rounded-lg text-sm border border-gray-200">
                {testResult}
              </pre>
            </div>
          )}
        </div>
      ),
    });
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={webhook ? 'Edit Webhook' : 'Add New Webhook'}
      size="xl"
    >
      {showIntegration && savedWebhook ? (
        /* Integration Details View */
        <div>
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="font-semibold text-green-900">✓ Webhook Saved Successfully!</h3>
            <p className="text-sm text-green-700 mt-1">
              Use these details to configure your external system to send orders to this webhook:
            </p>
          </div>

          <WebhookIntegrationDetails webhook={savedWebhook} />

          <div className="flex justify-end gap-3 pt-4 mt-6 border-t">
            <Button
              variant="primary"
              onClick={handleDone}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        /* Form View */
        <form onSubmit={handleSubmit}>
          <Tabs tabs={tabs} defaultTab="configuration" />

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 mt-6 border-t">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : webhook ? 'Update Webhook' : 'Add Webhook'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
