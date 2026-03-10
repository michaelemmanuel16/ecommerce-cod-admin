import React from 'react';
import { Trash2, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FormField, FieldType } from '../../types/checkout-form';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

interface FormFieldEditorProps {
  field: FormField;
  onUpdate: (field: FormField) => void;
  onDelete: () => void;
}

const fieldTypeOptions = [
  { value: 'text', label: 'Text' },
  { value: 'phone', label: 'Phone' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'select', label: 'Select' },
];

export const FormFieldEditor: React.FC<FormFieldEditorProps> = ({
  field,
  onUpdate,
  onDelete,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-gray-50 p-4 rounded-lg border border-gray-200"
    >
      <div className="flex items-start gap-3">
        <div
          {...attributes}
          {...listeners}
          className="mt-2 cursor-grab active:cursor-grabbing text-gray-400 touch-none"
        >
          <GripVertical className="w-5 h-5" />
        </div>

        <div className="flex-1 grid grid-cols-12 gap-3">
          <div className="col-span-4">
            <Input
              placeholder="Field Label"
              value={field.label}
              onChange={(e) => onUpdate({ ...field, label: e.target.value })}
            />
          </div>

          <div className="col-span-3">
            <Select
              options={fieldTypeOptions}
              value={field.type}
              onChange={(e) => onUpdate({ ...field, type: e.target.value as FieldType })}
            />
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(e) => onUpdate({ ...field, required: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Required</span>
            </label>
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.enabled}
                onChange={(e) => onUpdate({ ...field, enabled: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Enabled</span>
            </label>
          </div>

          <div className="col-span-1 flex items-center justify-end">
            <button
              onClick={onDelete}
              className="text-red-600 hover:text-red-700 p-1"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {field.type === 'select' && (
        <div className="mt-3 ml-8">
          <Input
            placeholder="Options (comma separated)"
            value={field.options?.join(', ') || ''}
            onChange={(e) => onUpdate({
              ...field,
              options: e.target.value.split(',').map(opt => opt.trim()).filter(Boolean)
            })}
          />
        </div>
      )}
    </div>
  );
};
