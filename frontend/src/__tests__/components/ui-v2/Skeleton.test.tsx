import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '../../../components/ui-v2';

describe('ui-v2 Skeleton', () => {
  it('renders a decorative .skel block with the given size', () => {
    const { container } = render(<Skeleton width={120} height={20} />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('skel');
    expect(el).toHaveAttribute('aria-hidden', 'true');
    expect(el).toHaveStyle({ width: '120px', height: '20px' });
  });
  it('defaults to a full-width text line', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveStyle({ width: '100%', height: '14px' });
  });
});
