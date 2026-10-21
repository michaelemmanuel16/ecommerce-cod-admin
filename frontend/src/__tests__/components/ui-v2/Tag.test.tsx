import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tag } from '../../../components/ui-v2';

describe('ui-v2 Tag', () => {
  it('renders the text with the .tag class, neutral by default', () => {
    render(<Tag>Pending</Tag>);
    expect(screen.getByText('Pending')).toHaveClass('tag', 'n');
  });
  it.each(['ok', 'bad', 'warn', 'v', 'n'] as const)('tone %s adds its class', (tone) => {
    render(<Tag tone={tone}>x-{tone}</Tag>);
    expect(screen.getByText(`x-${tone}`)).toHaveClass('tag', tone);
  });
});
