import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateRangePicker } from '../../components/ui/DateRangePicker';

// The picker sends calendar days (YYYY-MM-DD) for both bounds; the backend applies the store zone.
// Dates are built from local calendar parts (parseISO), so these tests do not depend on the machine's time zone.
describe('DateRangePicker', () => {
  it('applies the range as two yyyy-MM-dd strings', () => {
    const onChange = vi.fn();
    render(<DateRangePicker startDate="2026-10-01" endDate="2026-10-17" onChange={onChange} />);

    fireEvent.click(screen.getByText(/Oct 01, 2026 - Oct 17, 2026/));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onChange).toHaveBeenCalledWith('2026-10-01', '2026-10-17');
  });

  it('shows the same calendar days it was given', () => {
    render(<DateRangePicker startDate="2026-10-01" endDate="2026-10-17" onChange={vi.fn()} />);
    expect(screen.getByText('Oct 01, 2026 - Oct 17, 2026')).toBeInTheDocument();
  });

  it('has no button inside a button, and Clear dates clears without opening the calendar (M5 UI fix V3)', () => {
    const onChange = vi.fn();
    const { container } = render(<DateRangePicker startDate="2026-10-01" endDate="2026-10-17" onChange={onChange} />);
    expect(container.querySelectorAll('button button')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }));
    expect(onChange).toHaveBeenCalledWith(undefined, undefined);
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });
});
