import React, { useState } from 'react';
import { Pencil, Trash2, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FormField } from '../../../types/checkout-form';
import { FIELD_TYPES, getFieldTypeMeta } from './fieldTypes';
import { FieldEditModal } from '../FieldEditModal';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';

interface FieldRowProps {
  field: FormField;
  onEdit: () => void;
  onToggleRequired: () => void;
  onDelete: () => void;
}

const FieldRow: React.FC<FieldRowProps> = ({ field, onEdit, onToggleRequired, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const meta = getFieldTypeMeta(field.type);
  const Icon = meta.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-3"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 touch-none"
      >
        <GripVertical className="w-5 h-5" />
      </div>

      <Icon className="w-5 h-5 text-gray-700 flex-shrink-0" />

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-gray-900 truncate">{field.label}</p>
        <p className="text-xs text-gray-500">{meta.label}</p>
      </div>

      {field.required && (
        <span className="text-xs font-medium text-gray-600 bg-gray-100 rounded-full px-2 py-0.5">
          Required
        </span>
      )}

      <button
        type="button"
        onClick={onToggleRequired}
        title={field.required ? 'Make optional' : 'Make required'}
        className={`text-xs font-semibold rounded-md border px-2 py-1 transition-colors ${
          field.required
            ? 'border-red-300 text-red-600 hover:bg-red-50'
            : 'border-gray-300 text-gray-500 hover:bg-gray-50'
        }`}
      >
        {field.required ? 'R*' : 'R'}
      </button>

      <button
        type="button"
        onClick={onEdit}
        title="Edit field"
        className="text-gray-500 hover:text-gray-800 p-1"
      >
        <Pencil className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onDelete}
        title="Delete field"
        className="text-red-500 hover:text-red-700 p-1"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

export const FieldsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const sensors = useSensors(useSensor(PointerSensor));
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const editingField = ctx.fields.find((f) => f.id === editingFieldId) || null;

  return (
    <div className="space-y-6">
      {/* Add Form Fields */}
      <div className="border-2 border-dashed border-gray-300 rounded-xl p-5">
        <h3 className="text-base font-semibold text-gray-900 mb-4">Add Form Fields</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {FIELD_TYPES.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              type="button"
              onClick={() => ctx.addField(type)}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white py-5 text-gray-800 shadow-sm hover:border-gray-400 hover:shadow transition-all"
            >
              <Icon className="w-6 h-6" />
              <span className="text-sm font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Form Fields list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900">Form Fields</h3>
          <span className="text-sm text-gray-500">
            {ctx.fields.length} {ctx.fields.length === 1 ? 'field' : 'fields'}
          </span>
        </div>

        {ctx.fields.length === 0 ? (
          <div className="text-center text-sm text-gray-500 border border-gray-200 rounded-lg py-10">
            No fields yet. Add one from the grid above.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={ctx.handleFieldDragEnd}
          >
            <SortableContext
              items={ctx.fields.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {ctx.fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    onEdit={() => setEditingFieldId(field.id)}
                    onToggleRequired={() =>
                      ctx.updateField(field.id, { ...field, required: !field.required })
                    }
                    onDelete={() => ctx.deleteField(field.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {editingField && (
        <FieldEditModal
          field={editingField}
          onClose={() => setEditingFieldId(null)}
          onSave={(updated) => {
            ctx.updateField(updated.id, updated);
            setEditingFieldId(null);
          }}
        />
      )}
    </div>
  );
};
