import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../../../components/ui-v2';

describe('ui-v2 Card', () => {
  it('renders children in a .card', () => {
    const { container } = render(<Card>Body</Card>);
    expect(container.firstChild).toHaveClass('card');
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(container.querySelector('.ct')).toBeNull();
  });
  it('renders the title row (.ct) with aside text', () => {
    const { container } = render(<Card title="Orders" aside="Updated 06:42">Body</Card>);
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(container.querySelector('.ct span')).toHaveTextContent('Updated 06:42');
  });
});
