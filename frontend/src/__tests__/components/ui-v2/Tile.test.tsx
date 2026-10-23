import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tile, Tag } from '../../../components/ui-v2';

describe('ui-v2 Tile', () => {
  it('renders value, label, icon tone and footer', () => {
    const { container } = render(
      <Tile icon={<svg data-testid="i" />} tone="coral" value="48%" label="Delivery success rate" footer={<><span>Target 60%</span><Tag tone="bad">12 pts</Tag></>} />,
    );
    expect(container.firstChild).toHaveClass('card', 'kpi');
    expect(container.querySelector('.v')).toHaveTextContent('48%');
    expect(screen.getByText('Delivery success rate')).toHaveClass('l');
    expect(container.querySelector('.ic')).toHaveClass('coral');
    expect(container.querySelector('.s')).toHaveTextContent('Target 60%');
  });
  it('leaves out the icon and footer when not given', () => {
    const { container } = render(<Tile value="64" label="Orders today" />);
    expect(container.querySelector('.ic')).toBeNull();
    expect(container.querySelector('.s')).toBeNull();
  });
});
