import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UiGallery from '../../pages/dev/UiGallery';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  document.documentElement.removeAttribute('data-theme');
});

describe('UI gallery (dev page)', () => {
  it('lists every component section', () => {
    render(<UiGallery />);
    for (const title of ['Button', 'Tag', 'Tile', 'Card', 'Tabs and Table', 'Input and Select', 'EmptyState and Skeleton']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
  });

  it('?theme=dark starts in dark mode', () => {
    window.history.replaceState(null, '', '/?theme=dark');
    render(<UiGallery />);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('?open=modal opens the modal, and it closes', async () => {
    window.history.replaceState(null, '', '/?open=modal');
    render(<UiGallery />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
