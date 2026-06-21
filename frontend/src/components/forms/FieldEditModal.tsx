import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { FieldType, FormField } from '../../types/checkout-form';
import { FIELD_TYPES, getFieldTypeMeta } from './builder/fieldTypes';

interface FieldEditModalProps {
  field: FormField;
  onClose: () => void;
  onSave: (field: FormField) => void;
}

const typeOptions = FIELD_TYPES.map((t) => ({ value: t.type, label: t.label }));

export const FieldEditModal: React.FC<FieldEditModalProps> = ({ field, onClose, onSave }) => {
  const [draft, setDraft] = useState<FormField>(field);
  const typeMeta = getFieldTypeMeta(draft.type);
  const showOptions = typeMeta.hasOptions;
  const labelEmpty = !draft.label.trim();
  const options = draft.options ?? [];

  const update = (patch: Partial<FormField>) => setDraft((prev) => ({ ...prev, ...patch }));

  const updateOption = (index: number, value: string) =>
    update({ options: options.map((o, i) => (i === index ? value : o)) });

  const addOption = () => update({ options: [...options, `Option ${options.length + 1}`] });

  const removeOption = (index: number) =>
    update({ options: options.filter((_, i) => i !== index) });

  // When the type changes to an option-bearing type, seed a starter option.
  const handleTypeChange = (type: FieldType) => {
    const meta = getFieldTypeMeta(type);
    update({
      type,
      options: meta.hasOptions ? (options.length ? options : ['Option 1']) : undefined,
    });
  };

  const handleSave = () => {
    if (labelEmpty) return;
    onSave({
      ...draft,
      label: draft.label.trim(),
      placeholder: draft.placeholder?.trim() || undefined,
      options: showOptions ? options.map((o) => o.trim()).filter(Boolean) : undefined,
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Edit Field">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Field Type</label>
          <Select
            options={typeOptions}
            value={draft.type}
            onChange={(e) => handleTypeChange(e.target.value as FieldType)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Label <span className="text-red-500">*</span>
          </label>
          <Input
            value={draft.label}
            onChange={(e) => update({ label: e.target.value })}
            placeholder="e.g., Full Name"
          />
          {labelEmpty && <p className="text-xs text-red-500 mt-1">Label is required</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Placeholder</label>
          <Input
            value={draft.placeholder || ''}
            onChange={(e) => update({ placeholder: e.target.value })}
            placeholder="Placeholder text"
          />
        </div>

        {showOptions && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Options</label>
              <Button type="button" variant="secondary" size="sm" onClick={addOption}>
                <Plus className="h-4 w-4 mr-1" />
                Add Option
              </Button>
            </div>
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option}
                    onChange={(e) => updateOption(index, e.target.value)}
                    placeholder={`Option ${index + 1}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    aria-label={`Delete option ${index + 1}`}
                    className="flex-shrink-0 p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {options.length === 0 && (
                <p className="text-xs text-gray-400">No options yet — add at least one.</p>
              )}
            </div>
            {typeMeta.optionsHelp && (
              <p className="text-xs text-gray-500 mt-2">{typeMeta.optionsHelp}</p>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Field Width (%)</label>
          <Input
            type="number"
            min={1}
            max={100}
            value={draft.widthPercent ?? 100}
            onChange={(e) => {
              const n = Number(e.target.value);
              update({ widthPercent: Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 100 });
            }}
          />
          <p className="text-xs text-gray-500 mt-1">
            Set two fields to 50% to place them on the same row.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Required Field</p>
            <p className="text-xs text-gray-500">Users must fill this field</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.required}
            aria-label="Required Field"
            onClick={() => update({ required: !draft.required })}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              draft.required ? 'bg-gray-900' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                draft.required ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={labelEmpty}>
          Update Field
        </Button>
      </div>
    </Modal>
  );
};
