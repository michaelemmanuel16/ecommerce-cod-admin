import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { FieldsTab } from '../../components/forms/builder/FieldsTab';
import { CheckoutBuilderContext, CheckoutBuilderContextValue } from '../../components/forms/builder/checkoutBuilderContextValue';
import { createFieldOfType } from '../../components/forms/builder/fieldTypes';
import { FieldType, FormField } from '../../types/checkout-form';

const Harness: React.FC<{ initial?: FormField[] }> = ({ initial = [] }) => {
  const [fields, setFields] = useState<FormField[]>(initial);
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
    </CheckoutBuilderContext.Provider>
  );
};

const readFields = (): FormField[] =>
  JSON.parse(screen.getByTestId('fields-snapshot').textContent || '[]');

describe('FieldsTab', () => {
  it('renders the full Add Form Fields grid including State', () => {
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

  it('edits checkbox options via the modal — add option and helper text persist', () => {
    render(<Harness initial={[createFieldOfType('checkbox')]} />);
    fireEvent.click(screen.getByTitle('Edit field'));
    expect(
      screen.getByText(/tick one or more options from this checkbox group/i)
    ).toBeInTheDocument();
    // createFieldOfType('checkbox') seeds one option; adding makes two.
    fireEvent.click(screen.getByRole('button', { name: /Add Option/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Update Field' }));
    const fields = readFields();
    expect(fields[0].type).toBe('checkbox');
    expect(fields[0].options).toHaveLength(2);
  });

  it('edits a field via the modal — label and width persist', () => {
    render(<Harness initial={[createFieldOfType('text')]} />);
    fireEvent.click(screen.getByTitle('Edit field'));
    const dialog = screen.getByText('Edit Field').closest('div')!.parentElement as HTMLElement;
    const labelInput = within(dialog).getByPlaceholderText('e.g., Full Name') as HTMLInputElement;
    fireEvent.change(labelInput, { target: { value: 'Full Name' } });
    const widthInput = dialog.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Field' }));
    const fields = readFields();
    expect(fields[0].label).toBe('Full Name');
    expect(fields[0].widthPercent).toBe(50);
  });
});
