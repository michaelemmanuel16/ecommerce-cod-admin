import React, { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, Tag } from '../../ui-v2';
import { FormField, StandardFieldKey } from '../../../types/checkout-form';
import { FIELD_TYPES, getFieldTypeMeta } from './fieldTypes';
import { FieldEditModal } from '../FieldEditModal';
import { useCheckoutBuilder } from './checkoutBuilderContextValue';
import { getStandardFieldMeta, mapFields, missingKeysMessage, resolveStandardKey } from '../../../lib/standardFields';

// Fields whose answers Meta uses to match a buyer to an ad click: name, phone, email and town (F-412).
const META_KEYS: StandardFieldKey[] = ['fullName', 'phone', 'email', 'town'];
const META_NOTE = 'This field helps Meta match buyers.';

interface FieldRowProps {
  field: FormField;
  standardKey: StandardFieldKey | null;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onToggleRequired: () => void;
  onToggleEnabled: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}

const FieldRow: React.FC<FieldRowProps> = ({ field, standardKey, isFirst, isLast, onEdit, onToggleRequired, onToggleEnabled, onMove, onDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const meta = getFieldTypeMeta(field.type);
  const Icon = meta.icon;
  // Where this field's value lands. "Custom" is legitimate for extra questions, but it's also what a mislabelled
  // address field silently becomes, so it's shown on every row rather than only on the standard ones.
  const destination = getStandardFieldMeta(standardKey)?.label ?? 'Custom';
  const enabled = field.enabled !== false;

  return (
    <div ref={setNodeRef} style={style} className="frow" data-testid="field-row">
      <span className="gr" {...attributes} {...listeners} aria-label={`Drag ${field.label}`}>
        <GripVertical size={18} />
      </span>
      <Icon size={18} aria-hidden="true" />
      <div className="sp" style={enabled ? undefined : { opacity: 0.55 }}>
        <b>{field.label}</b>
        <small>
          {meta.label} · sends to {destination}
        </small>
      </div>
      <label className="sw">
        <input type="checkbox" checked={enabled} aria-label={`Show ${field.label}`} onChange={onToggleEnabled} />
        <span className="tg" />
      </label>
      <Button size="mini" aria-pressed={field.required} title={field.required ? 'Make optional' : 'Make required'} onClick={onToggleRequired}>
        {field.required ? 'Required' : 'Optional'}
      </Button>
      <Button size="icon-sm" aria-label={`Move ${field.label} up`} disabled={isFirst} onClick={() => onMove(-1)}>
        <ArrowUp />
      </Button>
      <Button size="icon-sm" aria-label={`Move ${field.label} down`} disabled={isLast} onClick={() => onMove(1)}>
        <ArrowDown />
      </Button>
      <Button size="icon-sm" aria-label={`Edit ${field.label}`} title="Edit field" onClick={onEdit}>
        <Pencil />
      </Button>
      <Button size="icon-sm" className="dng" aria-label={`Delete ${field.label}`} title="Delete field" onClick={onDelete}>
        <Trash2 />
      </Button>
    </div>
  );
};

/** Regions the form delivers to (F-413): the regions of the store's country, all selected at first; at least one stays. */
const RegionsEditor: React.FC = () => {
  const { allRegions, regions, setRegions, country } = useCheckoutBuilder();
  if (allRegions.length === 0) return null;
  const onlyOne = regions.length <= 1;
  const toggle = (region: string, on: boolean) =>
    setRegions((prev) => (on ? allRegions.filter((r) => r === region || prev.includes(r)) : prev.length > 1 ? prev.filter((r) => r !== region) : prev));

  return (
    <div>
      <div className="paneh" style={{ marginTop: 6 }}>
        <h3>Regions</h3>
        <p>Customers pick a region from this list. Untick the ones you do not deliver to in {country}.</p>
      </div>
      <fieldset className="regions" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="hint" style={{ padding: 0 }}>
          {regions.length} of {allRegions.length} regions selected
        </legend>
        {allRegions.map((region) => {
          const on = regions.includes(region);
          return (
            <label key={region}>
              <input type="checkbox" checked={on} disabled={on && onlyOne} onChange={(e) => toggle(region, e.target.checked)} />
              {region}
            </label>
          );
        })}
      </fieldset>
      {onlyOne && <p className="hint">Keep at least one region.</p>}
    </div>
  );
};

export const FieldsTab: React.FC = () => {
  const ctx = useCheckoutBuilder();
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [metaNote, setMetaNote] = useState(false);
  const editingField = ctx.fields.find((f) => f.id === editingFieldId) || null;

  // A required slot with no field feeding it means the server refuses to switch the form on (F-411): say so here, where
  // it is fixable, with the server's own words.
  const guard = missingKeysMessage(ctx.fields, ctx.formType);

  // Rows show the destination each field actually WINS, not the one its label resolves to: when two fields resolve to
  // the same slot only the first claims it, and a row that claimed nothing must read "Custom". Enabled fields only.
  const claimedKeyByFieldId = new Map(
    mapFields(ctx.fields.filter((f) => f.enabled !== false)).map((m) => [m.field.id, m.standardKey]),
  );

  const helpsMeta = (field: FormField) => {
    const key = resolveStandardKey(field);
    return key !== null && META_KEYS.includes(key);
  };

  const move = (index: number, direction: -1 | 1) =>
    ctx.setFields((prev) => (index + direction < 0 || index + direction >= prev.length ? prev : arrayMove(prev, index, index + direction)));

  const remove = (field: FormField) => {
    if (helpsMeta(field)) setMetaNote(true);
    ctx.deleteField(field.id);
  };

  const toggleEnabled = (field: FormField) => {
    const enabled = field.enabled !== false;
    if (enabled && helpsMeta(field)) setMetaNote(true);
    ctx.updateField(field.id, { ...field, enabled: !enabled });
  };

  return (
    <div className="stack">
      <div className="paneh">
        <h3>Fields</h3>
        <p>Customers fill these in. “Sends to” says where each answer lands on the order.</p>
      </div>

      {guard && (
        <div className="banner-warn" role="alert">
          <AlertTriangle aria-hidden="true" />
          <div>
            <b>{guard}</b>
            Add a field for it, or open an existing field and set “Sends to”.
          </div>
        </div>
      )}

      {metaNote && (
        <p className="fnote" role="status">
          {META_NOTE}
        </p>
      )}

      <div>
        <div className="head" style={{ marginBottom: 10 }}>
          <b>Form fields</b>
          <span className="hint" style={{ margin: 0 }}>
            {ctx.fields.length} {ctx.fields.length === 1 ? 'field' : 'fields'}
          </span>
        </div>

        {ctx.fields.length === 0 ? (
          <p className="hint">No fields yet. Add one below. A form with no fields uses the standard ones.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={ctx.handleFieldDragEnd}>
            <SortableContext items={ctx.fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              <div className="frow-list">
                {ctx.fields.map((field, index) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    standardKey={claimedKeyByFieldId.get(field.id) ?? null}
                    isFirst={index === 0}
                    isLast={index === ctx.fields.length - 1}
                    onEdit={() => setEditingFieldId(field.id)}
                    onToggleRequired={() => ctx.updateField(field.id, { ...field, required: !field.required })}
                    onToggleEnabled={() => toggleEnabled(field)}
                    onMove={(direction) => move(index, direction)}
                    onDelete={() => remove(field)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div>
        <div className="fl"><label>Add a field</label></div>
        <div className="types">
          {FIELD_TYPES.map(({ type, label, icon: Icon }) => (
            <button key={type} type="button" onClick={() => ctx.addField(type)}>
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </div>

      <RegionsEditor />

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
