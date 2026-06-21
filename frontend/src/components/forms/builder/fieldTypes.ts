import {
  Type,
  Mail,
  Phone,
  Hash,
  AlignLeft,
  ChevronDown,
  CheckSquare,
  ListChecks,
  MapPin,
  LucideIcon,
} from 'lucide-react';
import { FieldType, FormField } from '../../../types/checkout-form';

export interface FieldTypeMeta {
  type: FieldType;
  /** Label shown on the "Add Form Fields" card and in the type dropdown. */
  label: string;
  icon: LucideIcon;
  /** Default label applied when a field of this type is first added. */
  defaultLabel: string;
  /** Whether the type carries an editable options list. */
  hasOptions: boolean;
  /** Caption shown under the options editor explaining how customers interact. */
  optionsHelp?: string;
}

// Order matches the Salesgee "Add Form Fields" grid, with State appended.
export const FIELD_TYPES: readonly FieldTypeMeta[] = [
  { type: 'text', label: 'Text Input', icon: Type, defaultLabel: 'Text', hasOptions: false },
  { type: 'email', label: 'Email', icon: Mail, defaultLabel: 'Email Address', hasOptions: false },
  { type: 'phone', label: 'Phone Number', icon: Phone, defaultLabel: 'Phone Number', hasOptions: false },
  { type: 'number', label: 'Number', icon: Hash, defaultLabel: 'Number', hasOptions: false },
  { type: 'textarea', label: 'Text Area', icon: AlignLeft, defaultLabel: 'Message', hasOptions: false },
  {
    type: 'select',
    label: 'Dropdown',
    icon: ChevronDown,
    defaultLabel: 'Dropdown',
    hasOptions: true,
    optionsHelp: 'Customers can select one option from this dropdown.',
  },
  {
    type: 'checkbox',
    label: 'Checkbox',
    icon: CheckSquare,
    defaultLabel: 'Checkbox',
    hasOptions: true,
    optionsHelp: 'Customers can tick one or more options from this checkbox group.',
  },
  {
    type: 'multiselect',
    label: 'Multi Select',
    icon: ListChecks,
    defaultLabel: 'Multi Select',
    hasOptions: true,
    optionsHelp: 'Customers can select multiple options from this dropdown.',
  },
  { type: 'state', label: 'State', icon: MapPin, defaultLabel: 'State', hasOptions: false },
] as const;

export function getFieldTypeMeta(type: FieldType): FieldTypeMeta {
  return FIELD_TYPES.find((t) => t.type === type) ?? FIELD_TYPES[0];
}

/** Build a fresh field of the given type with sensible defaults. */
export function createFieldOfType(type: FieldType): FormField {
  const meta = getFieldTypeMeta(type);
  return {
    id: crypto.randomUUID(),
    label: meta.defaultLabel,
    type,
    required: type === 'state',
    enabled: true,
    widthPercent: 100,
    ...(meta.hasOptions ? { options: ['Option 1'] } : {}),
  };
}
