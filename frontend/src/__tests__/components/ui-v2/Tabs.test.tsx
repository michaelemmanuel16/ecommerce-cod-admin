import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '../../../components/ui-v2';

const items = [{ id: 'all', label: 'All', count: 1445 }, { id: 'pending', label: 'Pending', count: 64 }, { id: 'done', label: 'Delivered' }];

describe('ui-v2 Tabs', () => {
  it('renders a tablist with the selected tab and counts', () => {
    render(<Tabs label="Status" items={items} value="pending" onChange={() => {}} />);
    expect(screen.getByRole('tablist', { name: 'Status' })).toBeInTheDocument();
    const pending = screen.getByRole('tab', { name: /Pending/ });
    expect(pending).toHaveAttribute('aria-selected', 'true');
    expect(pending).toHaveClass('tab', 'on');
    expect(pending).toHaveTextContent('64');
    expect(screen.getByRole('tab', { name: 'Delivered' }).querySelector('span')).toBeNull();
  });
  it('calls onChange on click', async () => {
    const onChange = vi.fn();
    render(<Tabs label="Status" items={items} value="all" onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole('tab', { name: /Pending/ }));
    expect(onChange).toHaveBeenCalledWith('pending');
  });
  it('is one tab stop; arrows, Home and End move focus and selection', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [v, setV] = useState('all');
      return <Tabs label="Status" items={items} value={v} onChange={setV} />;
    }
    render(<Harness />);
    expect(screen.getByRole('tab', { name: /Pending/ })).toHaveAttribute('tabindex', '-1');
    await user.tab();
    expect(screen.getByRole('tab', { name: /All/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Pending/ })).toHaveFocus();
    expect(screen.getByRole('tab', { name: /Pending/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Delivered' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Delivered' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveFocus();
  });
});
