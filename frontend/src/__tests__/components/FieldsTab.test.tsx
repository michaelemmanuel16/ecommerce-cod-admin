import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FieldsTab } from '../../components/forms/builder/FieldsTab';
import { CheckoutBuilderContext, CheckoutBuilderContextValue } from '../../components/forms/builder/checkoutBuilderContextValue';
import { createFieldOfType } from '../../components/forms/builder/fieldTypes';
import { FieldType, FormField, FormType } from '../../types/checkout-form';

const REGIONS = ['Ashanti', 'Greater Accra', 'Volta'];

const Harness: React.FC<{ initial?: FormField[]; formType?: FormType }> = ({ initial = [], formType = 'physical' }) => {
  const [fields, setFields] = useState<FormField[]>(initial);
  const [regions, setRegions] = useState<string[]>(REGIONS);
  const ctx: CheckoutBuilderContextValue = {
    register: (() => ({})) as any,
    watch: (() => undefined) as any,
    setValue: (() => undefined) as any,
    errors: {} as any,
    fields,
    setFields,
    packages: [],
    setPackages: () => undefined,
    upsells: [],
    setUpsells: () => undefined,
    upsellImages: new Map(),
    setUpsellImages: () => undefined,
    pixelConfig: {},
    setPixelConfig: () => undefined,
    design: {},
    setDesign: () => undefined,
    products: [],
    country: 'Ghana',
    currency: 'GHS',
    formType,
    isEditing: false,
    hasOrders: false,
    originalProductId: null,
    allRegions: REGIONS,
    regions,
    setRegions,
    showErrors: false,
    addField: (type: FieldType) => setFields((prev) => [...prev, createFieldOfType(type)]),
    updateField: (id, updated) => setFields((prev) => prev.map((f) => (f.id === id ? updated : f))),
    deleteField: (id) => setFields((prev) => prev.filter((f) => f.id !== id)),
    handleFieldDragEnd: () => undefined,
    addPackage: () => undefined,
    updatePackage: () => undefined,
    deletePackage: () => undefined,
    addUpsell: () => undefined,
    updateUpsell: () => undefined,
    deleteUpsell: () => undefined,
    handleUpsellImageSelect: () => undefined,
    handleRemoveUpsellImage: () => undefined,
  };
  return (
    <CheckoutBuilderContext.Provider value={ctx}>
      <FieldsTab />
      <pre data-testid="fields-snapshot">{JSON.stringify(fields)}</pre>
      <pre data-testid="regions-snapshot">{JSON.stringify(regions)}</pre>
    </CheckoutBuilderContext.Provider>
  );
};

const readFields = (): FormField[] => JSON.parse(screen.getByTestId('fields-snapshot').textContent || '[]');
const readRegions = (): string[] => JSON.parse(screen.getByTestId('regions-snapshot').textContent || '[]');
const labels = () => readFields().map((f) => f.label);

const named = (label: string, extra: Partial<FormField> = {}): FormField => ({
  ...createFieldOfType('text'),
  id: label,
  label,
  ...extra,
});

// Every slot a physical order needs.
const complete = (): FormField[] => [
  named('Full Name', { standardKey: 'fullName' }),
  named('Phone', { type: 'phone', standardKey: 'phone' }),
  named('State', { type: 'state', standardKey: 'region' }),
  named('Street address', { type: 'textarea', standardKey: 'streetAddress' }),
];

describe('FieldsTab', () => {
  it('renders the add grid with all nine types, the state type as State', () => {
    render(<Harness />);
    ['Text Input', 'Email', 'Phone Number', 'Number', 'Text Area', 'Dropdown', 'Checkbox', 'Multi Select', 'State'].forEach(
      (label) => expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    );
  });

  it('shows an empty state when there are no fields', () => {
    render(<Harness />);
    expect(screen.getByText(/No fields yet/i)).toBeInTheDocument();
    expect(screen.getByText('0 fields')).toBeInTheDocument();
  });

  it('clicking a type card appends a field of that type', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    const fields = readFields();
    expect(fields).toHaveLength(1);
    expect(fields[0].type).toBe('email');
    expect(screen.getByText('1 field')).toBeInTheDocument();
  });

  it('adds a State field that is required by default', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'State' }));
    const fields = readFields();
    expect(fields[0].type).toBe('state');
    expect(fields[0].required).toBe(true);
  });

  it('deletes a field', () => {
    render(<Harness initial={[createFieldOfType('text')]} />);
    expect(readFields()).toHaveLength(1);
    fireEvent.click(screen.getByTitle('Delete field'));
    expect(readFields()).toHaveLength(0);
  });

  describe('required-key guard (F-411)', () => {
    it("says what is missing: \"This form can't take orders yet. Add: Street address.\"", () => {
      render(<Harness initial={complete().filter((f) => f.label !== 'Street address')} />);
      expect(screen.getByRole('alert')).toHaveTextContent("This form can't take orders yet. Add: Street address.");
    });

    it('is quiet when every required slot is fed', () => {
      render(<Harness initial={complete()} />);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('asks for email, not street address, on a digital form', () => {
      render(<Harness formType="digital" initial={complete().filter((f) => f.label !== 'Street address')} />);
      expect(screen.getByRole('alert')).toHaveTextContent("Add: Email.");
    });

    it('does not block a form with no fields: the platform defaults apply', () => {
      render(<Harness />);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('updates as soon as a field is switched off', () => {
      render(<Harness initial={complete()} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show Street address' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Add: Street address.');
    });
  });

  describe('Meta note (F-412)', () => {
    it('shows "This field helps Meta match buyers." when a phone field is removed', () => {
      render(<Harness initial={complete()} />);
      expect(screen.queryByText('This field helps Meta match buyers.')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Delete Phone' }));
      expect(screen.getByText('This field helps Meta match buyers.')).toBeInTheDocument();
    });

    it('shows it when an email field is switched off', () => {
      render(<Harness initial={[named('Email', { type: 'email', standardKey: 'email' })]} />);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show Email' }));
      expect(screen.getByText('This field helps Meta match buyers.')).toBeInTheDocument();
    });

    it('stays away for a field Meta does not use', () => {
      render(<Harness initial={[named('Street address', { standardKey: 'streetAddress' })]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Delete Street address' }));
      expect(screen.queryByText('This field helps Meta match buyers.')).toBeNull();
    });
  });

  describe('Up and Down buttons', () => {
    const three = () => [named('One'), named('Two'), named('Three')];

    it('moves a field up and down', () => {
      render(<Harness initial={three()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Move Three up' }));
      expect(labels()).toEqual(['One', 'Three', 'Two']);
      fireEvent.click(screen.getByRole('button', { name: 'Move One down' }));
      expect(labels()).toEqual(['Three', 'One', 'Two']);
    });

    it('disables Up on the first field and Down on the last', () => {
      render(<Harness initial={three()} />);
      expect(screen.getByRole('button', { name: 'Move One up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Three down' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move Two up' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Move Two down' })).toBeEnabled();
    });
  });

  describe('edit field', () => {
    const open = (label: string) => fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }));

    it('offers the Sends to options of F-412', () => {
      render(<Harness initial={[named('Name')]} />);
      open('Name');
      const dialog = screen.getByRole('dialog');
      const options = within(within(dialog).getByLabelText('Sends to')).getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual([
        'Auto: detect from label',
        'Customer name',
        'Phone',
        'Alternate phone',
        'Email',
        'State',
        'City or town',
        'Street address',
        'Order notes',
        'Nearest landmark',
        'Custom field only',
      ]);
    });

    it('saves a Sends to of Order notes', () => {
      render(<Harness initial={[named('Anything else?')]} />);
      open('Anything else?');
      fireEvent.change(within(screen.getByRole('dialog')).getByLabelText('Sends to'), { target: { value: 'notes' } });
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      expect(readFields()[0].standardKey).toBe('notes');
    });

    it('edits checkbox options: add option and helper text persist', () => {
      render(<Harness initial={[createFieldOfType('checkbox')]} />);
      open('Checkbox');
      expect(screen.getByText(/tick one or more options from this checkbox group/i)).toBeInTheDocument();
      // createFieldOfType('checkbox') seeds one option; adding makes two.
      fireEvent.click(screen.getByRole('button', { name: /Add option/i }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      const fields = readFields();
      expect(fields[0].type).toBe('checkbox');
      expect(fields[0].options).toHaveLength(2);
    });

    it('edits label and width (Half) and they persist', () => {
      render(<Harness initial={[createFieldOfType('text')]} />);
      open('Text');
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Full Name' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Half' }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));
      const fields = readFields();
      expect(fields[0].label).toBe('Full Name');
      expect(fields[0].widthPercent).toBe(50);
    });

    it('will not save an empty label', () => {
      render(<Harness initial={[createFieldOfType('text')]} />);
      open('Text');
      fireEvent.change(screen.getByLabelText('Label'), { target: { value: '  ' } });
      expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
      expect(screen.getByText('Label is required')).toBeInTheDocument();
    });
  });

  describe('regions (F-413)', () => {
    const boxes = () => within(screen.getByRole('group', { name: /states selected/i })).getAllByRole('checkbox');

    it('lists the regions of the country, all selected', () => {
      render(<Harness />);
      expect(boxes().map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, true]);
      expect(screen.getByText('3 of 3 states selected')).toBeInTheDocument();
    });

    it('lets the owner untick a region and tick it back', () => {
      render(<Harness />);
      fireEvent.click(screen.getByLabelText('Volta'));
      expect(readRegions()).toEqual(['Ashanti', 'Greater Accra']);
      fireEvent.click(screen.getByLabelText('Volta'));
      expect(readRegions()).toEqual(['Ashanti', 'Greater Accra', 'Volta']);
    });

    it('keeps the last region: its box is disabled and the hint shows', () => {
      render(<Harness />);
      fireEvent.click(screen.getByLabelText('Volta'));
      expect(screen.queryByText('Keep at least one state.')).toBeNull();
      fireEvent.click(screen.getByLabelText('Ashanti'));
      expect(readRegions()).toEqual(['Greater Accra']);
      expect(screen.getByLabelText('Greater Accra')).toBeDisabled();
      expect(screen.getByText('Keep at least one state.')).toBeInTheDocument();
      fireEvent.click(screen.getByLabelText('Greater Accra'));
      expect(readRegions()).toEqual(['Greater Accra']);
    });
  });
});
