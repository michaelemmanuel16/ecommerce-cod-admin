import React from 'react';
import { Plus } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { FormFieldEditor } from '../FormFieldEditor';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';

export const BasicsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const sensors = useSensors(useSensor(PointerSensor));

  const productOptions = [
    { value: 0, label: 'Select Product' },
    ...ctx.products.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Form Name <span className="text-red-500">*</span>
          </label>
          <Input
            {...ctx.register('name', { required: 'Form name is required' })}
            placeholder="e.g., Summer Sale Checkout"
          />
          {ctx.errors.name && (
            <p className="text-xs text-red-500 mt-1">{ctx.errors.name.message}</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            URL Slug <span className="text-red-500">*</span>
          </label>
          <Input
            {...ctx.register('slug', { required: 'Slug is required' })}
            placeholder="auto-generated-from-name"
            readOnly
            className="bg-gray-50"
          />
          {ctx.errors.slug && (
            <p className="text-xs text-red-500 mt-1">{ctx.errors.slug.message}</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Product <span className="text-red-500">*</span>
        </label>
        <Select
          {...ctx.register('productId', {
            valueAsNumber: true,
            validate: (value) => value > 0 || 'Please select a product',
          })}
          options={productOptions}
        />
        {ctx.errors.productId ? (
          <p className="text-xs text-red-500 mt-1">{ctx.errors.productId.message}</p>
        ) : (
          <p className="text-xs text-gray-500 mt-1">
            Required: Choose which product this checkout form is for
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
        <textarea
          {...ctx.register('description')}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter form description..."
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900">Form Fields</h3>
          <Button type="button" variant="secondary" size="sm" onClick={ctx.addField}>
            <Plus className="w-4 h-4 mr-1" />
            Add Field
          </Button>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={ctx.handleFieldDragEnd}>
          <SortableContext items={ctx.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {ctx.fields.map((field) => (
                <FormFieldEditor
                  key={field.id}
                  field={field}
                  onUpdate={(updated) => ctx.updateField(field.id, updated)}
                  onDelete={() => ctx.deleteField(field.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
};
