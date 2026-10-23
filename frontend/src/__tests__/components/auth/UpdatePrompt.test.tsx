import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdatePrompt } from '../../../components/pwa/UpdatePrompt';

const sw = vi.hoisted(() => ({ needRefresh: false, update: vi.fn() }));
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [sw.needRefresh], updateServiceWorker: sw.update }),
}));

beforeEach(() => {
  sw.needRefresh = false;
  sw.update.mockClear();
});

describe('Update prompt toast (F-109)', () => {
  it('shows nothing while the app is current', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the toast when a new version is waiting, and Update reloads into it', async () => {
    sw.needRefresh = true;
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toHaveTextContent('A new version is available.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Update' }));
    expect(sw.update).toHaveBeenCalledWith(true);
  });
});
