import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../../../components/ui-v2';

describe('ui-v2 Input', () => {
  it('connects the label to the input and accepts typing', async () => {
    render(<Input label="Customer name" />);
    const input = screen.getByLabelText(/Customer name/);
    await userEvent.setup().type(input, 'Abena');
    expect(input).toHaveValue('Abena');
    expect(input.closest('.fl')).not.toBeNull();
  });
  it('shows the optional marker and the hint, linked by aria-describedby', () => {
    render(<Input label="Email" optional hint="We send the receipt here" />);
    expect(screen.getByText('(optional)')).toHaveClass('opt');
    expect(screen.getByLabelText(/Email/)).toHaveAccessibleDescription('We send the receipt here');
  });
  it('shows an error instead of the hint and sets aria-invalid', () => {
    render(<Input label="Phone" hint="Ten digits" error="Enter a valid phone number" />);
    const input = screen.getByLabelText(/Phone/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid phone number');
    expect(screen.queryByText('Ten digits')).toBeNull();
  });
  it('is reachable by Tab', async () => {
    const user = userEvent.setup();
    render(<Input label="Name" />);
    await user.tab();
    expect(screen.getByLabelText(/Name/)).toHaveFocus();
  });
});
