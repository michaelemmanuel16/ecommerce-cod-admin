import React from 'react';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { FieldMapping, INTERNAL_FIELDS } from '../../types/webhook';
import { Button } from '../ui/Button';

interface FieldMappingEditorProps {
  mappings: FieldMapping[];
  onChange: (mappings: FieldMapping[]) => void;
  errors?: string;
}

export const FieldMappingEditor: React.FC<FieldMappingEditorProps> = ({
  mappings,
  onChange,
  errors
}) => {
  const handleAddMapping = () => {
    onChange([...mappings, { external: '', internal: '' }]);
  };

  const handleRemoveMapping = (index: number) => {
    const updated = mappings.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleUpdateMapping = (
    index: number,
    field: 'external' | 'internal',
    value: string
  ) => {
    const updated = [...mappings];
    updated[index][field] = value;
    onChange(updated);
  };

  // Group internal fields by category
  const fieldsByCategory = INTERNAL_FIELDS.reduce((acc, field) => {
    const category = field.category || 'other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(field);
    return acc;
  }, {} as Record<string, typeof INTERNAL_FIELDS>);

  const categoryLabels: Record<string, string> = {
    customer: 'Customer Fields',
    delivery: 'Delivery Fields',
    product: 'Product Fields',
    order: 'Order Fields',
    other: 'Other Fields'
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Field Mapping</h3>
          <p className="text-xs text-gray-500 mt-1">
            Map external field names to internal fields. customerPhone is required.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddMapping}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Mapping
        </Button>
      </div>

      {/* Error message */}
      {errors && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{errors}</p>
        </div>
      )}

      {/* Mapping rows */}
      {mappings.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-300 rounded-lg">
          <p className="text-gray-500 text-sm">
            No field mappings yet. Click "Add Mapping" to start.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-3 text-xs font-medium text-gray-500 uppercase">
            <div className="col-span-5">External Field Name</div>
            <div className="col-span-1 text-center">→</div>
            <div className="col-span-5">Internal Field</div>
            <div className="col-span-1"></div>
          </div>

          {/* Mapping rows */}
          {mappings.map((mapping, index) => (
            <div key={index} className="grid grid-cols-12 gap-3 items-center">
              {/* External field (text input) */}
              <div className="col-span-5">
                <input
                  type="text"
                  value={mapping.external}
                  onChange={(e) => handleUpdateMapping(index, 'external', e.target.value)}
                  placeholder="e.g., customer_phone"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              {/* Arrow */}
              <div className="col-span-1 flex justify-center">
                <ArrowRight className="w-5 h-5 text-gray-400" />
              </div>

              {/* Internal field (dropdown with categories) */}
              <div className="col-span-5">
                <select
                  value={mapping.internal}
                  onChange={(e) => handleUpdateMapping(index, 'internal', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">Select internal field...</option>
                  {Object.entries(fieldsByCategory).map(([category, fields]) => (
                    <optgroup key={category} label={categoryLabels[category] || category}>
                      {fields.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Remove button */}
              <div className="col-span-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleRemoveMapping(index)}
                  className="text-red-600 hover:text-red-800 p-1"
                  title="Remove mapping"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help text */}
      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Example for your use case:</strong>
        </p>
        <div className="mt-2 space-y-1 text-xs text-blue-700 font-mono">
          <div>customer_phone → Customer Phone *</div>
          <div>customer_name → Customer First Name</div>
          <div>product_name → Product Name/SKU</div>
          <div>quantity → Quantity</div>
          <div>price → Unit Price</div>
          <div>package → Package Description</div>
          <div>address → Delivery Address</div>
        </div>
      </div>
    </div>
  );
};
