import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../../../components/ui-v2';

describe('ui-v2 Select', () => {
  it('renders a labelled field and changes value from the keyboard', async () => {
    const onChange = vi.fn();
    render(
      <Select label="Status" onChange={onChange}>
        <option value="a">Pending</option>
        <option value="b">Confirmed</option>
      </Select>,
    );
    const sel = screen.getByLabelText('Status');
    expect(sel.closest('.fl')).not.toBeNull();
    await userEvent.setup().selectOptions(sel, 'b');
    expect(onChange).toHaveBeenCalled();
    expect(sel).toHaveValue('b');
  });
  it('compact is a bare .psel with an aria-label', () => {
    render(<Select compact label="Period"><option>Today</option></Select>);
    const sel = screen.getByRole('combobox', { name: 'Period' });
    expect(sel).toHaveClass('psel');
    expect(sel.closest('.fl')).toBeNull();
  });
  it('shows the error and sets aria-invalid', () => {
    render(<Select label="Region" error="Pick a region"><option>Accra</option></Select>);
    expect(screen.getByLabelText('Region')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Region')).toHaveAccessibleDescription('Pick a region');
  });
});
