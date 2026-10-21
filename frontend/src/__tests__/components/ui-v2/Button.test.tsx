import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../../components/ui-v2';

describe('ui-v2 Button', () => {
  it('renders .btn with type="button" by default', () => {
    render(<Button>Export</Button>);
    const b = screen.getByRole('button', { name: 'Export' });
    expect(b).toHaveClass('btn');
    expect(b).toHaveAttribute('type', 'button');
  });
  it('maps variants and sizes to the app.css classes', () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="danger">D</Button>
        <Button size="mini" variant="primary">M</Button>
        <Button size="icon-sm" aria-label="I" />
      </>,
    );
    expect(screen.getByText('P')).toHaveClass('btn', 'pri');
    expect(screen.getByText('D')).toHaveClass('btn', 'danger');
    expect(screen.getByText('M')).toHaveClass('mini', 'pri');
    expect(screen.getByLabelText('I')).toHaveClass('ibtn', 'sm');
  });
  it('clicks with the mouse and with Enter and Space', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByText('Go'));
    await user.tab();
    screen.getByText('Go').focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });
  it('does not click when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Go</Button>);
    await userEvent.setup().click(screen.getByText('Go'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
