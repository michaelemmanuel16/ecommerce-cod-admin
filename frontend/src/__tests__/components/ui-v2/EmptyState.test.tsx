import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState, Button } from '../../../components/ui-v2';

describe('ui-v2 EmptyState', () => {
  it('renders title, text, icon and action', () => {
    const { container } = render(
      <EmptyState icon={<svg data-testid="ic" />} title="Nothing here" text="You are caught up." action={<Button>Add order</Button>} />,
    );
    expect(container.firstChild).toHaveClass('empty');
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('You are caught up.')).toBeInTheDocument();
    expect(screen.getByTestId('ic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add order' })).toBeInTheDocument();
  });
  it('title only', () => {
    const { container } = render(<EmptyState title="No orders" />);
    expect(container.querySelector('p')).toBeNull();
  });
});
