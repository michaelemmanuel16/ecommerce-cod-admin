import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '../../../components/ui-v2';

describe('ui-v2 Tooltip', () => {
  it('is hidden by default and described by the trigger', () => {
    render(<Tooltip label="Confirmed orders divided by new orders"><button type="button">Rate</button></Tooltip>);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rate' })).toHaveAccessibleDescription('Confirmed orders divided by new orders');
  });
  it('shows on hover and hides on leave', async () => {
    const user = userEvent.setup();
    render(<Tooltip label="Formula"><button type="button">Rate</button></Tooltip>);
    await user.hover(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Formula');
    await user.unhover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('shows on keyboard focus and hides on Escape and blur', async () => {
    const user = userEvent.setup();
    render(<Tooltip label="Formula"><button type="button">Rate</button></Tooltip>);
    await user.tab();
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.tab();
    await user.tab({ shift: true });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
