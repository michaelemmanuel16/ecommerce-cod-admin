import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Modal, Select } from '../ui-v2';
import { FieldType, FormField, StandardFieldKey } from '../../types/checkout-form';
import { FIELD_TYPES, getFieldTypeMeta } from './builder/fieldTypes';
import { STANDARD_FIELDS, getStandardFieldMeta, resolveStandardKey } from '../../lib/standardFields';

interface FieldEditModalProps {
  field: FormField;
  onClose: () => void;
  onSave: (field: FormField) => void;
}

// '' = infer from the label (the behaviour for every field built before this picker existed). Anything else pins the
// destination so the label can be reworded freely without the value silently stopping at customFields.
const destinationOptions = [
  { value: '', label: 'Auto: detect from label' },
  ...STANDARD_FIELDS.map((f) => ({ value: f.key, label: f.label })),
  { value: 'custom', label: 'Custom field only' },
];

const FULL = 100;
const HALF = 50;

export const FieldEditModal: React.FC<FieldEditModalProps> = ({ field, onClose, onSave }) => {
  const [draft, setDraft] = useState<FormField>(field);
  const typeMeta = getFieldTypeMeta(draft.type);
  const showOptions = typeMeta.hasOptions;
  const labelEmpty = !draft.label.trim();
  const options = draft.options ?? [];
  const width = draft.widthPercent ?? FULL;
  // Where this field's value will actually land, under the current label and destination setting: shown live so a
  // mis-mapped field is visible here rather than discovered as a rejected order.
  const resolvedKey = resolveStandardKey(draft);

  const update = (patch: Partial<FormField>) => setDraft((prev) => ({ ...prev, ...patch }));
  const updateOption = (index: number, value: string) =>
    update({ options: options.map((o, i) => (i === index ? value : o)) });
  const addOption = () => update({ options: [...options, `Option ${options.length + 1}`] });
  const removeOption = (index: number) => update({ options: options.filter((_, i) => i !== index) });

  // When the type changes to an option-bearing type, seed a starter option.
  const handleTypeChange = (type: FieldType) => {
    const meta = getFieldTypeMeta(type);
    update({ type, options: meta.hasOptions ? (options.length ? options : ['Option 1']) : undefined });
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
    <Modal
      open
      onClose={onClose}
      title="Edit field"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={labelEmpty}>Done</Button>
        </>
      }
    >
      <Select label="Field type" value={draft.type} onChange={(e) => handleTypeChange(e.target.value as FieldType)}>
        {FIELD_TYPES.map((t) => (
          <option key={t.type} value={t.type}>{t.label}</option>
        ))}
      </Select>

      <Input
        label="Label"
        value={draft.label}
        onChange={(e) => update({ label: e.target.value })}
        placeholder="e.g. Full Name"
        error={labelEmpty ? 'Label is required' : undefined}
      />

      <Select
        label="Sends to"
        value={draft.standardKey ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          update({ standardKey: v === '' ? undefined : (v as StandardFieldKey | 'custom') });
        }}
        hint={
          resolvedKey
            ? `This answer is saved as the order's ${getStandardFieldMeta(resolvedKey)?.label.toLowerCase()}.`
            : 'This answer is saved with the order but is not used as the name, phone, address or region.'
        }
      >
        {destinationOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>

      <Input
        label="Placeholder"
        optional
        value={draft.placeholder || ''}
        onChange={(e) => update({ placeholder: e.target.value })}
        placeholder="Placeholder text"
      />

      {showOptions && (
        <div className="fl">
          <label>Options</label>
          <div className="stack">
            {options.map((option, index) => (
              <div key={index} className="linkrow">
                <input
                  value={option}
                  aria-label={`Option ${index + 1}`}
                  onChange={(e) => updateOption(index, e.target.value)}
                  placeholder={`Option ${index + 1}`}
                />
                <Button size="icon-sm" className="dng" aria-label={`Delete option ${index + 1}`} onClick={() => removeOption(index)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            {options.length === 0 && <p className="hint">No options yet. Add at least one.</p>}
            <div>
              <Button size="mini" onClick={addOption}>
                <Plus /> Add option
              </Button>
            </div>
          </div>
          {typeMeta.optionsHelp && <p className="hint">{typeMeta.optionsHelp}</p>}
        </div>
      )}

      <div className="fl">
        <label id="field-width-label">Width</label>
        <div className="seg" role="group" aria-labelledby="field-width-label">
          <button type="button" className={width === FULL ? 'on' : undefined} aria-pressed={width === FULL} onClick={() => update({ widthPercent: FULL })}>
            Full
          </button>
          <button type="button" className={width === HALF ? 'on' : undefined} aria-pressed={width === HALF} onClick={() => update({ widthPercent: HALF })}>
            Half
          </button>
        </div>
        <p className="hint">
          {width !== FULL && width !== HALF ? `This field is ${width}% wide. ` : ''}Two half-width fields share a row.
        </p>
      </div>

      <label className="sw">
        <input type="checkbox" checked={draft.required} aria-label="Required" onChange={(e) => update({ required: e.target.checked })} />
        <span className="tg" />
        Required
      </label>
    </Modal>
  );
};
